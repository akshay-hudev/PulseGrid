import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { requireInternalService } from '../http/auth';

const router = Router();
router.use(requireInternalService);

const syncUserSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  image: z.string().url().nullable().optional(),
});

router.post('/sync', async (request, response) => {
  const input = syncUserSchema.parse(request.body);
  const normalizedEmail = input.email.toLowerCase();

  const user = await prisma.$transaction(async (transaction) => {
    const persistedUser = await transaction.user.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        name: input.name,
        image: input.image,
        emailVerified: new Date(),
      },
      update: { name: input.name, image: input.image },
    });

    await transaction.senderAccount.upsert({
      where: {
        userId_email: { userId: persistedUser.id, email: normalizedEmail },
      },
      create: {
        userId: persistedUser.id,
        email: normalizedEmail,
        displayName: input.name,
        hourlyLimit: 200,
        minDelayMs: 2_000,
      },
      update: { displayName: input.name, isActive: true },
    });

    return persistedUser;
  });

  response.json({
    user: { id: user.id, email: user.email, name: user.name, image: user.image },
  });
});

export default router;
