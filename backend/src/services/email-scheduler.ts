import { createHash, randomUUID } from 'node:crypto';
import { EMAIL_JOB_NAME } from '../types/email-job';
import { emailJobOptions, emailQueue } from '../queues/email';
import { prisma } from '../config/prisma';
import { EmailStatus, type Email } from '../generated/prisma/client';
import { HttpError } from '../http/errors';
import { logger } from '../utils/logger';

export interface ScheduleEmailsInput {
  userId: string;
  senderAccountId: string;
  recipients: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  idempotencyKey?: string;
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function emailIdempotencyKey(batchSeed: string, recipient: string, index: number): string {
  return createHash('sha256')
    .update(`${batchSeed}\u0000${index}\u0000${recipient.toLowerCase()}`)
    .digest('hex');
}

async function enqueueEmails(emails: Email[]): Promise<void> {
  if (emails.length === 0) return;

  await emailQueue.addBulk(
    emails.map((email) => ({
      name: EMAIL_JOB_NAME,
      data: { emailId: email.id },
      opts: emailJobOptions(email.bullmqJobId, email.scheduledAt),
    })),
  );

  await prisma.email.updateMany({
    where: {
      id: { in: emails.map((email) => email.id) },
      status: EmailStatus.SCHEDULED,
    },
    data: { status: EmailStatus.QUEUED },
  });
}

export async function scheduleEmails(input: ScheduleEmailsInput): Promise<Email[]> {
  const sender = await prisma.senderAccount.findFirst({
    where: { id: input.senderAccountId, userId: input.userId, isActive: true },
  });
  if (!sender) throw new HttpError(404, 'Active sender account not found');

  const batchSeed = input.idempotencyKey ?? randomUUID();
  const batchId = stableUuid(`${input.userId}\u0000${batchSeed}`);

  const emails = input.recipients.map((recipient, index) => {
    const scheduledAt = new Date(
      input.startTime.getTime() + index * input.delayBetweenEmailsMs,
    );
    const idempotencyKey = emailIdempotencyKey(batchSeed, recipient, index);
    return {
      id: randomUUID(),
      userId: input.userId,
      senderAccountId: sender.id,
      batchId,
      bullmqJobId: stableUuid(idempotencyKey),
      idempotencyKey,
      fromEmail: sender.email,
      toEmail: recipient.toLowerCase(),
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      scheduledAt,
      maxAttempts: 5,
    };
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.senderAccount.update({
      where: { id: sender.id },
      data: {
        hourlyLimit: input.hourlyLimit,
        minDelayMs: input.delayBetweenEmailsMs,
      },
    });
    await transaction.email.createMany({ data: emails, skipDuplicates: true });
  });

  const persistedEmails = await prisma.email.findMany({
    where: { userId: input.userId, batchId },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
  });

  try {
    await enqueueEmails(persistedEmails);
  } catch (error) {
    logger.error('Queue publication failed; startup reconciliation will retry', {
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpError(503, 'Emails were persisted but the queue is temporarily unavailable');
  }

  return persistedEmails;
}

export async function reconcileScheduledEmails(batchSize = 1_000): Promise<number> {
  const pending = await prisma.email.findMany({
    where: { status: { in: [EmailStatus.SCHEDULED, EmailStatus.QUEUED] } },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
  });
  await enqueueEmails(pending);
  return pending.length;
}
