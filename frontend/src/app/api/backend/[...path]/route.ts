import { auth } from '@/auth';
import type { NextRequest } from 'next/server';

const allowedRoutes = new Set(['senders', 'scheduled', 'sent', 'schedule']);
const emailRoute = /^emails\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function forward(request: NextRequest, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await context.params;
  const route = path.join('/');
  if (!allowedRoutes.has(route) && !(request.method === 'DELETE' && emailRoute.test(route))) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const backendUrl = process.env.BACKEND_API_URL;
  const internalSecret = process.env.API_INTERNAL_SECRET;
  if (!backendUrl || !internalSecret) {
    return Response.json({ error: 'Backend bridge is not configured' }, { status: 503 });
  }

  const target = new URL(`/api/${route}`, backendUrl);
  target.search = request.nextUrl.search;
  const body = request.method === 'POST' ? await request.text() : undefined;

  try {
    const idempotencyKey = request.headers.get('idempotency-key');
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        'content-type': 'application/json',
        'x-api-internal-secret': internalSecret,
        'x-user-id': session.user.id,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body,
      cache: 'no-store',
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    return Response.json({ error: 'Scheduler API is unavailable' }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
