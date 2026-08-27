import app from './app';
import { getBaseEnv } from './config/env';
import { prisma } from './config/prisma';
import { emailQueue, emailQueueConnection } from './queues/email';
import { reconcileScheduledEmails } from './services/email-scheduler';
import { logger } from './utils/logger';

const env = getBaseEnv();
const server = app.listen(env.PORT, () => {
  logger.info('PulseGrid API listening', { port: env.PORT });
});

void reconcileScheduledEmails()
  .then((count) => logger.info('Queue reconciliation complete', { count }))
  .catch((error: unknown) => {
    logger.error('Queue reconciliation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Stopping API server', { signal });

  server.close(async (serverError) => {
    try {
      if (serverError) throw serverError;
      await emailQueue.close();
      await emailQueueConnection.quit();
      await prisma.$disconnect();
      process.exitCode = 0;
    } catch (error) {
      logger.error('API shutdown failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    }
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
