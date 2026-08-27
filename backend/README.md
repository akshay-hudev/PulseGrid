# PulseGrid Scheduler

PulseGrid is a production-oriented email scheduler built for the ReachInbox full-stack assignment. It persists email state in PostgreSQL, schedules execution with BullMQ delayed jobs, atomically enforces per-sender limits in Redis, delivers through Ethereal SMTP, and exposes a Google-authenticated Next.js command center.

No cron job, Node cron library, or in-memory rate counter is used.

## Architecture

```text
Browser
  │ Google OAuth / Auth.js session
  ▼
Next.js BFF ── signed internal identity ──► Express API
                                                │
                                  ┌─────────────┴─────────────┐
                                  ▼                           ▼
                            PostgreSQL                  BullMQ / Redis
                           durable state                delayed jobs
                                                              │
                                                              ▼
                                                    Worker concurrency pool
                                                              │
                                                     Redis Lua allocator
                                                              │
                                                              ▼
                                                        Ethereal SMTP
```

- **PostgreSQL is the business source of truth.** Redis may be rebuilt without losing email history.
- **BullMQ is the execution clock.** Every email receives a delayed job with a deterministic job ID.
- **The API and worker are separate processes.** Web traffic cannot block email delivery, and workers can scale horizontally.
- **The Next.js backend-for-frontend keeps the internal API secret server-side.** Browsers never receive it or choose their own user ID.

## Scheduling and persistence

1. `POST /api/schedule` validates and deduplicates up to 5,000 recipients.
2. Email rows are created transactionally with UUID job IDs and idempotency hashes.
3. BullMQ jobs are added in bulk with `delay = scheduledAt - now`.
4. Queue publication marks records `QUEUED`.
5. API startup reconciles `SCHEDULED` and `QUEUED` rows using the same job IDs. This repairs the database-to-queue crash window without duplicating jobs.
6. Redis AOF and PostgreSQL Docker volumes survive container restarts.

The lifecycle is:

```text
SCHEDULED → QUEUED → SENDING → SENT
                        │
                        └────→ RETRYING → SENDING
                                      └→ FAILED
```

## Rate limiting and concurrency

`WORKER_CONCURRENCY` controls parallel BullMQ processors and defaults to `10`.

Each `SenderAccount` has configurable `hourlyLimit` and `minDelayMs` values. Before SMTP delivery, the worker executes one Redis Lua script against a sender-specific hash. The script uses Redis server time and atomically:

- Resets the counter on a fixed UTC hour boundary.
- Checks the hourly counter.
- Checks the last granted timestamp against the minimum delay.
- Either increments the counter and grants delivery, or returns the exact next eligible timestamp.

When denied, the worker calls BullMQ `moveToDelayed(nextTimestamp, token)` and throws `DelayedError`. The job is not failed, dropped, or held inside a sleeping worker. The allocator is safe across multiple Node processes because the entire decision is one Redis operation.

For 1,000 emails due simultaneously, BullMQ activates only the configured concurrency. The Lua allocator grants legal sender slots; overflow returns to the delayed set and rolls into the next hour where necessary. Jobs are initially ordered by recipient position and scheduled time. Exact FIFO cannot be guaranteed across distributed workers, so the system preserves order on a best-effort basis while prioritizing correctness of provider limits.

## Idempotency trade-off

Deterministic BullMQ IDs, unique database constraints, persisted statuses, and startup reconciliation prevent ordinary duplicate execution. Ethereal SMTP does not expose an idempotency key, so no SMTP system can guarantee mathematical exactly-once delivery if a process dies after the remote server accepts a message but before the local `SENT` update commits. PulseGrid records provider message IDs and minimizes that window rather than claiming an impossible guarantee.

## Local setup

Requirements: Node.js 22+, npm, and Docker Desktop.

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run prisma:generate
npm run db:migrate -- --name init
```

Create an Ethereal account at `https://ethereal.email` and configure:

```env
ETHEREAL_SMTP_HOST="smtp.ethereal.email"
ETHEREAL_SMTP_PORT="587"
ETHEREAL_SMTP_USER="your-ethereal-user"
ETHEREAL_SMTP_PASS="your-ethereal-password"
WORKER_CONCURRENCY="10"
```

Run the backend in two terminals:

```bash
npm run dev
npm run worker
```

The API listens on `http://localhost:4000`; `GET /health` is public.

## Frontend and Google OAuth

The sibling `../frontend` application uses Auth.js with the real Google provider. In Google Cloud Console, create a Web OAuth client with:

```text
Authorized JavaScript origin: http://localhost:3000
Authorized redirect URI:      http://localhost:3000/api/auth/callback/google
```

Configure `frontend/.env.local` from its example, then run:

```bash
cd ../frontend
npm install
npm run dev
```

`API_INTERNAL_SECRET` must be identical in the backend `.env` and frontend `.env.local`.

## API

The application BFF supplies internal authentication headers. Direct backend calls require `x-api-internal-secret` and `x-user-id`.

### `POST /api/schedule`

```json
{
  "senderAccountId": "uuid",
  "recipients": ["lead@example.com"],
  "subject": "Hello",
  "body": "Scheduled through PulseGrid",
  "startTime": "2026-08-27T12:00:00.000Z",
  "delayBetweenEmailsMs": 2000,
  "hourlyLimit": 200
}
```

An optional `Idempotency-Key` header makes repeated submissions converge on the same batch.

### Read endpoints

- `GET /api/senders`
- `GET /api/scheduled?limit=50`
- `GET /api/sent?limit=50`

## Docker stack

From this directory:

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, the Express API, BullMQ worker, and Next.js frontend. Local database and Redis state use named volumes.

## Verification

```bash
npm run typecheck
npm run build
cd ../frontend && npm run lint && npm run build
```

## Five-minute demo plan

1. Sign in with Google and show the authenticated name, email, and avatar.
2. Upload a CSV, show detected recipient count, configure spacing/hourly ceiling, and launch.
3. Show emails moving from the live runway into Scheduled and Sent.
4. Stop the API and worker while a future email is pending; restart both and show that the delayed job still sends.
5. Schedule more messages than a low hourly limit and show `RETRYING` jobs moved to their next legal window.

## Implemented requirements

- Express + TypeScript API with strict validation and structured error handling
- PostgreSQL + Prisma durable state
- BullMQ delayed jobs backed by persistent Redis
- Ethereal SMTP delivery and preview links
- Configurable concurrency, minimum spacing, and per-sender hourly limits
- Atomic multi-worker rate enforcement with Redis Lua
- Retries, stalled-job recovery, reconciliation, graceful shutdown, and deterministic IDs
- Real Google OAuth via Auth.js
- Scheduled/Sent views, CSV parsing, compose flow, loading states, empty states, errors, and responsive UI
