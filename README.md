# PulseGrid

PulseGrid is a robust, enterprise-ready asynchronous email scheduling and dispatch platform. It handles high-throughput bulk email campaigns, persists every message state in PostgreSQL, executes delayed asynchronous work through BullMQ and Redis, and enforces distributed per-sender limits with an atomic Lua allocator. The Next.js command center is protected by secure Google OAuth via Auth.js.

Built for reliability, PulseGrid uses no cron jobs, no fragile in-memory rate counters, and ensures zero data loss during process restarts.

## Repository Layout

```text
.
├── backend/                 Express API, Prisma schema, BullMQ queue and worker
│   ├── prisma/              PostgreSQL schema and committed migrations
│   ├── src/routes/          Authenticated scheduling and archive endpoints
│   ├── src/services/        Transactional scheduling and queue reconciliation
│   └── src/workers/         Redis Lua allocator and SMTP worker
└── frontend/                Next.js App Router, Auth.js and PulseGrid UI
    ├── src/app/api/         Google OAuth and authenticated backend proxy
    └── src/components/      Command center, telemetry, tables and composer
```

## Architecture Overview

```text
Browser
  │ Google OAuth / Auth.js session
  ▼
Next.js BFF ── trusted user headers ──► Express API
                                             │
                              ┌──────────────┴──────────────┐
                              ▼                             ▼
                         PostgreSQL                    BullMQ / Redis
                       source of truth                delayed execution
                                                            │
                                                   Worker concurrency pool
                                                            │
                                                   Redis Lua allocator
                                                            │
                                                            ▼
                                                       SMTP Provider
```

### Scheduling: API → Prisma → BullMQ

1. The authenticated frontend sends `POST /api/backend/schedule` to its server-side proxy. The proxy verifies the Auth.js session and forwards the request to Express without exposing the internal API secret to the browser.
2. Express validates the request with Zod, normalizes and deduplicates up to 5,000 recipients, and verifies ownership of the selected sender.
3. Prisma transactionally stores one `Email` per recipient and updates that sender's hourly limit and minimum spacing. Each row has a unique idempotency hash and deterministic BullMQ job ID.
4. The service uses BullMQ `addBulk` to publish delayed jobs. Each delay is derived from `startTime + recipientIndex × delayBetweenEmailsMs`.
5. The worker loads the durable email record, acquires a legal send slot, records `SENDING`, submits through the SMTP provider, and records `SENT` plus its provider message ID and preview URL.

The normal lifecycle is:

```text
SCHEDULED → QUEUED → SENDING → SENT
                        │
                        └────→ RETRYING → SENDING
                                      └→ FAILED
```

### Persistence and Restart Recovery

PostgreSQL is the business source of truth; Redis is the persistent execution clock. Docker assigns named volumes to both PostgreSQL and Redis, and Redis uses append-only persistence (AOF).

The API reconciles `SCHEDULED` and `QUEUED` database rows at startup. It republishes them with their original deterministic BullMQ IDs, so a process failure between the database commit and queue publication is repaired without creating duplicate jobs. BullMQ also recovers delayed and stalled work after worker restarts. Completed records remain queryable from PostgreSQL even after old queue metadata is removed.

### Rate Limiting, Delay, and Concurrency

- `WORKER_CONCURRENCY` controls the number of BullMQ jobs processed concurrently (defaults to `10`).
- `SenderAccount.hourlyLimit` and `SenderAccount.minDelayMs` are configurable per sender from the compose flow.
- Before SMTP dispatch, a Redis Lua script uses Redis server time to atomically read the sender's fixed UTC-hour counter and last granted timestamp.
- A legal slot increments the counter and stores its grant time in the same atomic operation. A denied slot returns the exact next eligible timestamp and a reason (`HOURLY_LIMIT` or `MIN_DELAY`).
- The worker persists `RETRYING`, calls BullMQ `moveToDelayed(nextTimestamp, token)`, and throws `DelayedError`. It never drops the job or consumes a worker by sleeping.
- Because the decision occurs inside Redis, limits remain strictly enforced across concurrent jobs, multiple workers, and multiple application instances.

## Prerequisites

- Node.js 22 or later
- npm
- Docker Desktop with Docker Compose
- A Google Cloud OAuth 2.0 web client
- An SMTP Provider (Ethereal Email is configured by default for sandbox testing)

## Environment Setup

Copy the committed templates to create your local environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Generate two independent random secrets, for example:

```bash
openssl rand -base64 48
```

Use one output for `AUTH_SECRET`. Use the other for `API_INTERNAL_SECRET`, placing that same API secret in both environment files to secure the internal proxy bridge.

### `backend/.env`

```dotenv
NODE_ENV="development"
DATABASE_URL="postgresql://pulsegrid:pulsegrid_dev_only_change_me@localhost:5432/pulsegrid?schema=public"
REDIS_URL="redis://localhost:6379"
PORT="4000"
CORS_ORIGIN="http://localhost:3000"
EMAIL_QUEUE_NAME="pulsegrid-email"
WORKER_CONCURRENCY="10"
API_INTERNAL_SECRET="replace-with-at-least-32-random-characters"

# Defaulting to Ethereal Email for testing
ETHEREAL_SMTP_HOST="smtp.ethereal.email"
ETHEREAL_SMTP_PORT="587"
ETHEREAL_SMTP_USER="your-ethereal-username"
ETHEREAL_SMTP_PASS="your-ethereal-password"
```

### `frontend/.env.local`

```dotenv
AUTH_SECRET="replace-with-a-separate-random-secret"
AUTH_URL="http://localhost:3000"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
BACKEND_API_URL="http://localhost:4000"
API_INTERNAL_SECRET="must-exactly-match-backend-api-internal-secret"
```

In your Google Cloud Console, configure the OAuth web client with:
*   **Authorized JavaScript origin:** `http://localhost:3000`
*   **Authorized redirect URI:** `http://localhost:3000/api/auth/callback/google`

## Run the Complete Stack (Docker)

After configuring both environment files:

```bash
cd backend
docker compose up --build
```

Compose will spin up PostgreSQL, Redis, a one-shot Prisma migration service, the Express API, the BullMQ worker, and the Next.js frontend.

- Frontend UI: `http://localhost:3000`
- Backend API: `http://localhost:4000/health`

## Local Development Setup

If you prefer to run the Node services outside of Docker:

### 1. Start Infrastructure
```bash
cd backend
docker compose up -d postgres redis
```

### 2. Initialize Backend
```bash
cd backend
npm ci
npm run prisma:generate
npm run db:deploy
```
Run the API and worker in separate terminals:
```bash
npm run dev
npm run worker
```

### 3. Initialize Frontend
```bash
cd frontend
npm ci
npm run dev
```

## Production Deployment: Railway and Vercel

Deploy the Express API and BullMQ worker as two Railway services connected to the same managed PostgreSQL and Redis instances. Deploy `frontend/` as a separate Vercel project. Do not deploy the development Compose stack as one production service.

### Railway Service Configuration

Create managed PostgreSQL and Redis services first. Then create two services from the same GitHub repository:

| Setting | API Service | Worker Service |
|---|---|---|
| Root directory | `/backend` | `/backend` |
| Build | Auto-detected `backend/Dockerfile` | Auto-detected `backend/Dockerfile` |
| Start command | `npm run start` | `npm run start:worker` |
| Public domain | Required | None |
| Health check | `/health` | Not HTTP-based |
| Pre-deploy command | `npm run db:deploy` | None |

The Dockerfile executes the self-contained `npm run build` script, which generates Prisma Client before compiling TypeScript. Run migrations only from the API service's pre-deploy phase. Both services must deploy the same commit and share the same database, Redis instance, queue name, internal secret, and Ethereal credentials.

Configure these Railway variables on both API and worker unless marked otherwise:

| Variable | Required On | Production Check |
|---|---|---|
| `NODE_ENV` | Both | Exactly `production`. |
| `DATABASE_URL` | Both | Reference the managed PostgreSQL service's private `DATABASE_URL`; never use the local Docker URL. |
| `REDIS_URL` | Both | Reference the managed Redis service's private `REDIS_URL`, retaining its `redis://` or `rediss://` scheme. |
| `EMAIL_QUEUE_NAME` | Both | Use one stable value, such as `pulsegrid-email`. Changing it strands jobs in the previous queue. |
| `API_INTERNAL_SECRET` | API | At least 32 random characters and identical to Vercel's value. Never prefix it with `NEXT_PUBLIC_`. |
| `CORS_ORIGIN` | API | Exact Vercel production origin, such as `https://scheduler.example.com`, without a trailing slash. |
| `PORT` | API | Use Railway's injected value; do not hardcode port 4000 in Railway. |
| `WORKER_CONCURRENCY` | Worker | Start with `10`, then tune against SMTP and database capacity. |
| `ETHEREAL_SMTP_HOST` | Worker | `smtp.ethereal.email`. |
| `ETHEREAL_SMTP_PORT` | Worker | `587` for STARTTLS or `465` for implicit TLS. |
| `ETHEREAL_SMTP_USER` | Worker | Ethereal SMTP username stored as a secret. |
| `ETHEREAL_SMTP_PASS` | Worker | Ethereal SMTP password stored as a secret. |

After deployment, `/health` must return HTTP 200, the worker must log `Ethereal SMTP connection verified`, and the API must log `Queue reconciliation complete`.

### Vercel Project Configuration

Import the repository into Vercel and set the project Root Directory to `frontend`. Keep the detected framework as Next.js and the standard build command as `npm run build`; Vercel does not use `npm start` for its managed Next.js runtime.

| Variable | Production Check |
|---|---|
| `AUTH_SECRET` | Required by Auth.js v5; use a cryptographically random value of at least 32 characters. |
| `AUTH_URL` | Set to the stable HTTPS frontend origin. Auth.js v5 normally infers the host, but this documents the canonical production URL. |
| `NEXTAUTH_URL` | Legacy NextAuth-compatible alias. Set it to the same origin as `AUTH_URL`, without `/api/auth`. |
| `GOOGLE_CLIENT_ID` | Production Google OAuth Web Client ID for the deployed frontend origin. |
| `GOOGLE_CLIENT_SECRET` | Matching Google OAuth secret. Keep it server-only and never use a `NEXT_PUBLIC_` prefix. |
| `BACKEND_API_URL` | Public Railway API origin, without `/api` or a trailing slash. Only server-side route handlers use it. |
| `API_INTERNAL_SECRET` | Must exactly match the Railway API value and remain server-only. |

The production Google OAuth client must include:

```text
Authorized JavaScript origin: https://your-production-domain
Authorized redirect URI:      https://your-production-domain/api/auth/callback/google
```

Google does not accept arbitrary Vercel preview callback wildcards. For preview authentication, use a stable preview domain with its own OAuth client or Auth.js redirect-proxy configuration. Apply variables to the correct Vercel Production/Preview scopes and redeploy after any environment change.

### Production Release Checklist

- `npm ci && npm run build` succeeds from a clean checkout in both project directories.
- Prisma migrations complete before the API starts; never run `prisma migrate dev` in production.
- API and worker deploy from the same commit and share `DATABASE_URL`, `REDIS_URL`, and `EMAIL_QUEUE_NAME`.
- Only the API has a public Railway domain; PostgreSQL, Redis, and the worker remain private.
- Railway health checks and restart policies are enabled for both long-running services.
- Vercel, Railway `CORS_ORIGIN`, and Google OAuth use the same production HTTPS frontend origin.
- A scheduled Ethereal message reaches `SENT`, exposes a preview URL, and survives an API/worker restart.
- Secrets exist only in platform secret stores—not in Git, Docker build arguments, browser bundles, or logs.

## API Surface

The browser interacts exclusively with the authenticated Next.js proxy at `/api/backend/*`. Direct Express API calls require both `x-api-internal-secret` and `x-user-id` headers.

| Method | Express Route | Purpose |
|---|---|---|
| `GET` | `/health` | Public service health |
| `POST` | `/api/auth/sync` | Synchronize authenticated user and sender |
| `GET` | `/api/senders` | List active sender accounts |
| `POST` | `/api/schedule` | Persist and enqueue a recipient batch |
| `GET` | `/api/scheduled?limit=50` | Cursor-paginated active schedule |
| `GET` | `/api/sent?limit=50` | Cursor-paginated sent/failed archive |

## Core System Capabilities

### Backend Infrastructure
- **High-Throughput Scheduler:** Express/TypeScript API with Zod validation, bulk Prisma persistence, and BullMQ delayed job processing using deterministic IDs.
- **Robust Persistence:** PostgreSQL acts as the immutable source of truth, featuring startup state reconciliation, stalled-job recovery, and durable status history.
- **Distributed Rate Limiting:** An atomic Redis Lua allocator enforces per-sender hourly ceilings and minimum inter-message delays across horizontal deployments.
- **Worker Concurrency:** Environment-configurable worker pools with exponential backoff, graceful shutdown, and terminal failure persistence.

### Frontend Command Center
- **Secure Authentication:** NextAuth Google provider integration with protected routing and database user synchronization.
- **Live Telemetry:** Dashboard features real-time scheduled/sent counts, active sender capacity, and queue signal visualization.
- **Batch Composer:** Dynamic compose modal with CSV or text lead upload, unique email extraction, and highly configurable dispatch timing logic.
- **Archive Tracking:** Reusable tables for tracking recipient status, attempt details, errors, and live SMTP preview links.

## Quality Checks & CI

Run these standard checks before deploying to production:

```bash
cd backend
npm ci
npm run typecheck
npm run build
docker compose config --quiet

cd ../frontend
npm ci
npm run lint
npm run build
```

---
