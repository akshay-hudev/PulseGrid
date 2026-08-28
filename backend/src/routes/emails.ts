import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { EmailStatus } from '../generated/prisma/client';
import { type AuthenticatedRequest, requireInternalUser } from '../http/auth';
import { scheduleEmails } from '../services/email-scheduler';
import { emailQueue } from '../queues/email';

const router = Router();
router.use(requireInternalUser);

const scheduleSchema = z.object({
  senderAccountId: z.string().uuid(),
  recipients: z.array(z.string().trim().email()).min(1).max(5_000),
  subject: z.string().trim().min(1).max(998),
  body: z.string().min(1).max(1_000_000),
  htmlBody: z.string().max(2_000_000).optional(),
  startTime: z.coerce.date(),
  delayBetweenEmailsMs: z.number().int().min(1_000).max(3_600_000),
  hourlyLimit: z.number().int().min(1).max(10_000),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

const listSelect = {
  id: true,
  toEmail: true,
  fromEmail: true,
  subject: true,
  scheduledAt: true,
  sentAt: true,
  status: true,
  attemptCount: true,
  lastError: true,
  previewUrl: true,
} as const;

router.get('/senders', async (request, response) => {
  const senders = await prisma.senderAccount.findMany({
    where: { userId: (request as AuthenticatedRequest).userId, isActive: true },
    select: {
      id: true,
      email: true,
      displayName: true,
      hourlyLimit: true,
      minDelayMs: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  response.json({ items: senders });
});

router.post('/schedule', async (request, response) => {
  const body = scheduleSchema.parse(request.body);
  const emails = await scheduleEmails({
    userId: (request as AuthenticatedRequest).userId,
    senderAccountId: body.senderAccountId,
    recipients: [...new Set(body.recipients.map((email) => email.toLowerCase()))],
    subject: body.subject,
    textBody: body.body,
    htmlBody: body.htmlBody,
    startTime: body.startTime,
    delayBetweenEmailsMs: body.delayBetweenEmailsMs,
    hourlyLimit: body.hourlyLimit,
    idempotencyKey: request.header('idempotency-key'),
  });

  response.status(202).json({
    batchId: emails[0]?.batchId,
    scheduledCount: emails.length,
    emails: emails.map(({ id, toEmail, scheduledAt, status }) => ({
      id,
      email: toEmail,
      scheduledAt,
      status,
    })),
  });
});

router.get('/scheduled', async (request, response) => {
  const { limit, cursor } = paginationSchema.parse(request.query);
  const emails = await prisma.email.findMany({
    where: {
      userId: (request as AuthenticatedRequest).userId,
      status: {
        in: [
          EmailStatus.SCHEDULED,
          EmailStatus.QUEUED,
          EmailStatus.SENDING,
          EmailStatus.RETRYING,
        ],
      },
    },
    select: listSelect,
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = emails.length > limit;
  const items = hasMore ? emails.slice(0, limit) : emails;
  response.json({ items, nextCursor: hasMore ? items.at(-1)?.id : null });
});

router.get('/sent', async (request, response) => {
  const { limit, cursor } = paginationSchema.parse(request.query);
  const emails = await prisma.email.findMany({
    where: {
      userId: (request as AuthenticatedRequest).userId,
      status: { in: [EmailStatus.SENT, EmailStatus.FAILED] },
    },
    select: listSelect,
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = emails.length > limit;
  const items = hasMore ? emails.slice(0, limit) : emails;
  response.json({ items, nextCursor: hasMore ? items.at(-1)?.id : null });
});

router.delete('/emails/:emailId', async (request, response) => {
  const emailId = z.string().uuid().parse(request.params.emailId);
  const userId = (request as unknown as AuthenticatedRequest).userId;
  const email = await prisma.email.findFirst({
    where: { id: emailId, userId },
    select: { id: true, bullmqJobId: true, status: true },
  });

  if (!email) {
    response.status(404).json({ error: 'Email not found' });
    return;
  }
  if (email.status === EmailStatus.SENDING) {
    response.status(409).json({ error: 'An email cannot be deleted while it is sending' });
    return;
  }

  const job = await emailQueue.getJob(email.bullmqJobId);
  if (job) {
    try {
      await job.remove();
    } catch {
      response.status(409).json({ error: 'The queue is currently processing this email; try again shortly' });
      return;
    }
  }

  const deleted = await prisma.email.deleteMany({
    where: { id: email.id, userId, status: { not: EmailStatus.SENDING } },
  });
  if (deleted.count === 0) {
    response.status(409).json({ error: 'The email started sending before it could be deleted' });
    return;
  }

  response.status(204).send();
});

export default router;
