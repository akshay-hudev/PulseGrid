import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getBaseEnv } from '../config/env';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function requireInternalService(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const configuredSecret = getBaseEnv().API_INTERNAL_SECRET;
  if (!configuredSecret) {
    response.status(503).json({ error: 'API authentication is not configured' });
    return;
  }

  const suppliedSecret = request.header('x-api-internal-secret') ?? '';
  if (!secretsMatch(suppliedSecret, configuredSecret)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export function requireInternalUser(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  requireInternalService(request, response, () => {
    const userId = request.header('x-user-id');
    if (!userId) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    (request as AuthenticatedRequest).userId = userId;
    next();
  });
}
