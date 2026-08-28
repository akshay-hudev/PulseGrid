import { DelayedError, Job, UnrecoverableError, Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { getWorkerEnv } from '../config/env';
import { prisma } from '../config/prisma';
import { EmailStatus } from '../generated/prisma/client';
import { EMAIL_JOB_NAME, type EmailJobData, type EmailJobResult } from '../types/email-job';
import { RedisSendSlotAllocator } from './redis-allocator';
import { logger } from '../utils/logger';

const env = getWorkerEnv();
const workerConnection = createRedisConnection('email-worker');
const allocatorConnection = createRedisConnection('send-slot-allocator');
const allocator = new RedisSendSlotAllocator(allocatorConnection);

interface GatewayDeliveryResult {
  messageId: string;
  previewUrl: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 4_000);
  return String(error).slice(0, 4_000);
}

async function deliverThroughGateway(payload: Record<string, string | undefined>): Promise<GatewayDeliveryResult> {
  const response = await fetch(env.SMTP_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-internal-secret': env.API_INTERNAL_SECRET,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => null) as {
    messageId?: unknown;
    previewUrl?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok) {
    const detail = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    if (response.status === 400 || response.status === 413) {
      throw new UnrecoverableError(`SMTP gateway rejected delivery: ${detail}`);
    }
    throw new Error(`SMTP gateway delivery failed: ${detail}`);
  }
  if (
    typeof body?.messageId !== 'string'
    || (body.previewUrl !== null && typeof body.previewUrl !== 'string')
  ) {
    throw new Error('SMTP gateway returned an invalid response');
  }
  return { messageId: body.messageId, previewUrl: body.previewUrl };
}

async function delayActiveJob(
  job: Job<EmailJobData, EmailJobResult>,
  token: string | undefined,
  retryAt: Date,
  reason: string,
): Promise<never> {
  await prisma.email.update({
    where: { id: job.data.emailId },
    data: {
      status: EmailStatus.RETRYING,
      nextAttemptAt: retryAt,
      lastError: reason,
    },
  });
  await job.moveToDelayed(retryAt.getTime(), token);
  throw new DelayedError();
}

async function processEmail(
  job: Job<EmailJobData, EmailJobResult>,
  token?: string,
): Promise<EmailJobResult> {
  if (job.name !== EMAIL_JOB_NAME) {
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const email = await prisma.email.findUnique({
    where: { id: job.data.emailId },
    include: { senderAccount: true },
  });
  if (!email) throw new UnrecoverableError(`Email ${job.data.emailId} does not exist`);

  if (email.status === EmailStatus.SENT) {
    return {
      emailId: email.id,
      messageId: email.providerMessageId ?? 'already-sent',
      sentAt: (email.sentAt ?? new Date()).toISOString(),
    };
  }
  if (email.status === EmailStatus.CANCELLED) {
    throw new UnrecoverableError(`Email ${email.id} was cancelled`);
  }
  if (!email.senderAccount.isActive) {
    throw new UnrecoverableError(`Sender account ${email.senderAccountId} is inactive`);
  }
  if (email.scheduledAt.getTime() > Date.now()) {
    return delayActiveJob(job, token, email.scheduledAt, 'Waiting for scheduled time');
  }

  const allocation = await allocator.allocate(
    email.senderAccountId,
    email.senderAccount.hourlyLimit,
    email.senderAccount.minDelayMs,
  );
  if (!allocation.granted) {
    return delayActiveJob(
      job,
      token,
      allocation.retryAt,
      `Rate limited: ${allocation.reason}`,
    );
  }

  await prisma.email.update({
    where: { id: email.id },
    data: {
      status: EmailStatus.SENDING,
      attemptCount: { increment: 1 },
      lastAttemptAt: allocation.grantedAt,
      nextAttemptAt: null,
      lastError: null,
    },
  });

  try {
    const delivery = await deliverThroughGateway({
      emailId: email.id,
      fromEmail: email.fromEmail,
      fromName: email.senderAccount.displayName ?? email.fromEmail,
      toEmail: email.toEmail,
      subject: email.subject,
      textBody: email.textBody,
      ...(email.htmlBody ? { htmlBody: email.htmlBody } : {}),
    });

    const sentAt = new Date();
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.SENT,
        sentAt,
        providerMessageId: delivery.messageId,
        previewUrl: delivery.previewUrl,
        nextAttemptAt: null,
        lastError: null,
        version: { increment: 1 },
      },
    });

    return { emailId: email.id, messageId: delivery.messageId, sentAt: sentAt.toISOString() };
  } catch (error) {
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.RETRYING,
        lastError: errorMessage(error),
      },
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export const emailWorker = new Worker<EmailJobData, EmailJobResult>(
  env.EMAIL_QUEUE_NAME,
  processEmail,
  {
    connection: workerConnection,
    concurrency: env.WORKER_CONCURRENCY,
    maxStalledCount: 2,
    stalledInterval: 30_000,
  },
);

emailWorker.on('completed', (job) => {
  logger.info('Email job completed', { jobId: job.id, emailId: job.data.emailId });
});

emailWorker.on('failed', (job, error) => {
  logger.error('Email job failed', {
    jobId: job?.id,
    emailId: job?.data.emailId,
    attemptsMade: job?.attemptsMade,
    error: error.message,
  });
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts || error instanceof UnrecoverableError) {
    void prisma.email
      .updateMany({
        where: { id: job.data.emailId, status: { not: EmailStatus.SENT } },
        data: { status: EmailStatus.FAILED, lastError: errorMessage(error) },
      })
      .catch((databaseError: unknown) => {
        logger.error('Unable to persist terminal email failure', {
          emailId: job.data.emailId,
          error: errorMessage(databaseError),
        });
      });
  }
});

emailWorker.on('error', (error) => {
  logger.error('Email worker error', { error: error.message });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Stopping email worker', { signal });

  try {
    await emailWorker.close();
    await Promise.all([workerConnection.quit(), allocatorConnection.quit()]);
    await prisma.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    logger.error('Email worker shutdown failed', { error: errorMessage(error) });
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
