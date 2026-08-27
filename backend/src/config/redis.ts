import IORedis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { getBaseEnv } from './env';
import { logger } from '../utils/logger';

const options: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
};

export function createRedisConnection(name: string): IORedis {
  const redis = new IORedis(getBaseEnv().REDIS_URL, options);

  redis.on('ready', () => logger.info('Redis connection ready', { name }));
  redis.on('error', (error) => {
    logger.error('Redis connection error', { name, error: error.message });
  });

  return redis;
}
