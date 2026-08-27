import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { getBaseEnv } from './env';

const globalPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getBaseEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalPrisma.prisma ?? createPrismaClient();

if (getBaseEnv().NODE_ENV !== 'production') {
  globalPrisma.prisma = prisma;
}
