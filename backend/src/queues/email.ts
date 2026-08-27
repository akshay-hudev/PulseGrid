import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { getBaseEnv } from '../config/env';
import type { EmailJobData, EmailJobResult } from '../types/email-job';

export const emailQueueConnection = createRedisConnection('email-queue');

export const emailQueue = new Queue<EmailJobData, EmailJobResult>(
  getBaseEnv().EMAIL_QUEUE_NAME,
  {
    connection: emailQueueConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 25_000 },
    },
  },
);

export function emailJobOptions(jobId: string, scheduledAt: Date): JobsOptions {
  return {
    jobId,
    delay: Math.max(0, scheduledAt.getTime() - Date.now()),
  };
}
