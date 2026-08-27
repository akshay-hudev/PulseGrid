import { createHash } from 'node:crypto';
import type IORedis from 'ioredis';

const ALLOCATE_SEND_SLOT_LUA = `
local key = KEYS[1]
local maxPerHour = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])

if not maxPerHour or maxPerHour < 1 then
  return redis.error_reply('maxPerHour must be a positive integer')
end
if not minDelayMs or minDelayMs < 0 then
  return redis.error_reply('minDelayMs must be a non-negative integer')
end

local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
local hourMs = 3600000
local windowStartMs = nowMs - (nowMs % hourMs)
local state = redis.call('HMGET', key, 'windowStartMs', 'count', 'lastGrantedAtMs')
local storedWindowStartMs = tonumber(state[1])
local count = tonumber(state[2]) or 0
local lastGrantedAtMs = tonumber(state[3]) or 0

if storedWindowStartMs ~= windowStartMs then
  count = 0
  storedWindowStartMs = windowStartMs
end

local nextAtMs = nowMs
local reason = 'GRANTED'

if count >= maxPerHour then
  nextAtMs = windowStartMs + hourMs
  reason = 'HOURLY_LIMIT'
end

local delayEligibleAtMs = lastGrantedAtMs + minDelayMs
if delayEligibleAtMs > nextAtMs then
  nextAtMs = delayEligibleAtMs
  reason = 'MIN_DELAY'
end

if nextAtMs > nowMs then
  return { 0, nextAtMs, count, windowStartMs, reason }
end

count = count + 1
redis.call(
  'HSET',
  key,
  'windowStartMs', windowStartMs,
  'count', count,
  'lastGrantedAtMs', nowMs
)

local expireAtMs = windowStartMs + (2 * hourMs)
local delayExpiryMs = nowMs + minDelayMs + hourMs
if delayExpiryMs > expireAtMs then
  expireAtMs = delayExpiryMs
end
redis.call('PEXPIREAT', key, expireAtMs)

return { 1, nowMs, count, windowStartMs, 'GRANTED' }
`;

export type AllocationReason = 'GRANTED' | 'HOURLY_LIMIT' | 'MIN_DELAY';

export type AllocationResult =
  | { granted: true; grantedAt: Date; countInWindow: number; windowStartedAt: Date }
  | {
      granted: false;
      retryAt: Date;
      countInWindow: number;
      windowStartedAt: Date;
      reason: Exclude<AllocationReason, 'GRANTED'>;
    };

function parseInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Redis allocator returned an invalid ${label}`);
  }
  return parsed;
}

export class RedisSendSlotAllocator {
  public constructor(
    private readonly redis: IORedis,
    private readonly keyPrefix = 'pulsegrid:allocator',
  ) {}

  public async allocate(
    senderAccountId: string,
    maxPerHour: number,
    minDelayMs: number,
  ): Promise<AllocationResult> {
    if (!senderAccountId) throw new Error('senderAccountId is required');
    if (!Number.isSafeInteger(maxPerHour) || maxPerHour < 1) {
      throw new Error('maxPerHour must be a positive integer');
    }
    if (!Number.isSafeInteger(minDelayMs) || minDelayMs < 0) {
      throw new Error('minDelayMs must be a non-negative integer');
    }

    const senderHash = createHash('sha256').update(senderAccountId).digest('hex');
    const key = `${this.keyPrefix}:{${senderHash}}`;
    const raw = await this.redis.eval(
      ALLOCATE_SEND_SLOT_LUA,
      1,
      key,
      String(maxPerHour),
      String(minDelayMs),
    );

    if (!Array.isArray(raw) || raw.length !== 5) {
      throw new Error('Redis allocator returned a malformed response');
    }

    const granted = parseInteger(raw[0], 'grant flag') === 1;
    const timestamp = parseInteger(raw[1], 'timestamp');
    const countInWindow = parseInteger(raw[2], 'window count');
    const windowStart = parseInteger(raw[3], 'window start');
    const reason = String(raw[4]) as AllocationReason;

    if (granted) {
      return {
        granted: true,
        grantedAt: new Date(timestamp),
        countInWindow,
        windowStartedAt: new Date(windowStart),
      };
    }
    if (reason !== 'HOURLY_LIMIT' && reason !== 'MIN_DELAY') {
      throw new Error(`Redis allocator returned an unknown denial reason: ${reason}`);
    }
    return {
      granted: false,
      retryAt: new Date(timestamp),
      countInWindow,
      windowStartedAt: new Date(windowStart),
      reason,
    };
  }
}
