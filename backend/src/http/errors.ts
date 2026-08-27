import type { ErrorRequestHandler } from 'express';
import { Prisma } from '../generated/prisma/client';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: 'Invalid request',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    response.status(409).json({ error: 'A conflicting record already exists' });
    return;
  }

  logger.error('Unhandled request error', {
    error: error instanceof Error ? error.message : String(error),
  });
  response.status(500).json({ error: 'Internal server error' });
};
