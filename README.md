# PulseGrid Email Scheduler

PulseGrid is a full-stack email scheduling application built for the ReachInbox assignment. Users sign in with Google, upload a CSV or text file of recipients, choose when sending should begin, and configure the delay and hourly limit. The backend stores every email in PostgreSQL and executes it with persistent BullMQ jobs backed by Redis.

## Implemented Features

### Backend

- Express.js API written in TypeScript
- PostgreSQL persistence through Prisma
- BullMQ delayed jobs backed by Redis
- One durable job per recipient with a deterministic job ID
- Transactional batch creation and idempotency protection
- Startup reconciliation for database rows missing from the queue
- Ethereal SMTP delivery with provider message IDs and preview links
- Atomic, distributed per-sender rate limiting through Redis Lua
- Configurable minimum delay between sends
- Configurable BullMQ worker concurrency
- Exponential retry backoff and terminal failure tracking
- Graceful API and worker shutdown
- Scheduled, sent, sender-list, and delete-email endpoints
- Authenticated Next.js-to-Express server bridge

### Frontend

- Next.js App Router with TypeScript and Tailwind CSS
- Real Google OAuth through Auth.js/NextAuth
- Protected dashboard with the user name, email, avatar, and logout
- Live queue counts and automatic five-second refresh
- Queue activity view showing waiting and active emails
- Compose modal with sender, subject, body, start time, spacing, and hourly limit
- CSV or text upload with client-side email extraction and deduplication
- Scheduled-email and sent-email tables
- Ethereal preview links for accepted messages
- Per-email deletion with confirmation
- Loading, empty, retrying, failed, and error states
- Responsive, flat brutalist interface

## Repository Layout

```text
.
├── backend/
│   ├── prisma/                 Prisma schema and migrations
│   ├── src/routes/             Express API routes
│   ├── src/services/           Scheduling and reconciliation logic
│   ├── src/queues/             BullMQ queue configuration
│   ├── src/workers/            Worker and Redis Lua allocator
│   └── docker-compose.yml      Complete local stack
└── frontend/
    ├── src/app/                Next.js pages and server routes
    ├── src/components/         Dashboard, composer, and email table
    └── src/auth.ts             Auth.js Google configuration
```

## Architecture Overview

```text
Browser
  │
  │ Google OAuth session
  ▼
Next.js application
  │
  │ server-side proxy + API_INTERNAL_SECRET
  ▼
Express API ───────────────► PostgreSQL / Prisma
  │                              source of truth
  │
  └────────────────────────► BullMQ / Redis
                                 delayed jobs
                                      │
                                      ▼
                               BullMQ worker
                                      │
                               Redis Lua allocator
                                      │
                                      ▼
                         Next.js SMTP gateway route
                                      │
                                      ▼
                               Ethereal SMTP
```

The API and worker are separate processes. The API accepts requests and manages durable records; the worker stays connected to Redis and performs background sends. The browser never receives the internal API secret or Ethereal SMTP password.

## How Scheduling Works

1. The authenticated browser submits a batch to the Next.js route at `/api/backend/schedule`.
2. The Next.js server verifies the Auth.js session and forwards the request to Express with the internal service secret and authenticated user ID.
3. Express validates the payload, normalizes and deduplicates the recipient list, verifies the sender, and creates one `Email` row per recipient in a Prisma transaction.
4. Each row receives a unique idempotency key and deterministic BullMQ job ID.
5. BullMQ jobs are added in bulk with a delay calculated from:

   ```text
   start time + recipient position × delay between emails
   ```

6. When a job becomes due, the worker loads its PostgreSQL row and requests a legal sender slot from the Redis Lua allocator.
7. If a slot is available, the worker changes the status to `SENDING` and invokes the authenticated Next.js SMTP gateway.
8. The gateway sends through Ethereal and returns the message ID and preview URL. The worker records `SENT`, `sentAt`, and the provider data.
9. Temporary errors are retried with exponential backoff. Exhausted or unrecoverable jobs are recorded as `FAILED`.

Email states follow this lifecycle:

```text
SCHEDULED → QUEUED → SENDING → SENT
                        │
                        └────→ RETRYING → SENDING
                                      └→ FAILED
```

## Persistence and Restart Recovery

PostgreSQL is the business source of truth. It stores the recipient, message, schedule, job ID, attempt count, status, errors, sent time, and Ethereal provider metadata.

Redis is the persistent execution layer. BullMQ stores delayed, waiting, active, retrying, and completed job metadata there. The local Redis container enables append-only persistence, and both Redis and PostgreSQL use named Docker volumes.

On API startup, PulseGrid reconciles `SCHEDULED` and `QUEUED` database rows with BullMQ. Missing jobs are recreated with their original deterministic IDs and original scheduled times. This repairs a restart or failure between the database transaction and queue publication without creating a second job for the same email.

BullMQ also detects stalled work when a worker disappears. A restarted worker resumes pending and delayed jobs from Redis instead of rebuilding the schedule from the beginning. Already `SENT`, `FAILED`, or `CANCELLED` records are not re-enqueued by reconciliation.

There is one unavoidable distributed-systems edge case: SMTP does not offer an idempotency key. If a process dies after Ethereal accepts a message but before PostgreSQL records `SENT`, mathematical exactly-once delivery cannot be guaranteed. Deterministic queue IDs, persisted state, and provider IDs minimize this window.

## Rate Limiting, Delay, and Concurrency

### Worker concurrency

`WORKER_CONCURRENCY` controls how many BullMQ jobs one worker may process in parallel. It defaults to `10`. Multiple worker instances can run against the same queue when more throughput is required.

Concurrency does not bypass sender limits. Every active job must first pass the shared Redis allocator.

### Minimum delay between emails

Each `SenderAccount` stores `minDelayMs`. The compose modal updates this from the requested delay in seconds. Before sending, the Lua script compares Redis server time with the sender's last granted timestamp.

If the minimum gap has not elapsed, the script returns the next legal timestamp. The worker moves the job back to BullMQ's delayed set and throws BullMQ's `DelayedError`; it does not sleep and hold a worker slot.

### Emails per hour

Each sender also stores a configurable `hourlyLimit`. The Lua allocator keeps a sender-specific fixed UTC-hour counter in Redis. In one atomic operation it:

- reads Redis server time;
- determines the current hour window;
- resets an expired window;
- checks the hourly count and minimum-delay timestamp;
- grants a slot and increments the count, or returns the next allowed timestamp.

Because the entire decision is executed atomically inside Redis, the limit remains correct across concurrent jobs, multiple Node processes, and horizontally scaled workers.

If 1,000 emails become due at once, BullMQ activates only the configured number of jobs. The allocator admits sends at the configured spacing, moves overflow back to delayed jobs, and carries emails into the next hour when the hourly limit is reached. Initial recipient order is preserved through scheduled timestamps and bulk insertion; exact FIFO is best-effort once multiple workers execute concurrently.

## Prerequisites

- Node.js 22.12 or newer
- npm
- Docker Desktop with Docker Compose
- Google Cloud OAuth 2.0 web credentials
- An Ethereal Email test account

## Environment Variables

Create local environment files from the committed templates:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Generate two separate secrets:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

- Use one value as `AUTH_SECRET`.
- Use the other value as `API_INTERNAL_SECRET` in both environment files. The two copies must match exactly.
- Never prefix either secret with `NEXT_PUBLIC_`.

### Backend: `backend/.env`

```dotenv
NODE_ENV="development"
DATABASE_URL="postgresql://pulsegrid:pulsegrid_dev_only_change_me@localhost:5432/pulsegrid?schema=public"
REDIS_URL="redis://localhost:6379"
PORT="4000"
CORS_ORIGIN="http://localhost:3000"
EMAIL_QUEUE_NAME="pulsegrid-email"
WORKER_CONCURRENCY="10"
API_INTERNAL_SECRET="paste-the-shared-random-secret"
SMTP_GATEWAY_URL="http://localhost:3000/api/internal/email-delivery"
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection used by Prisma, the API, and the worker |
| `REDIS_URL` | Redis connection used by BullMQ and the rate allocator |
| `PORT` | Express listening port |
| `CORS_ORIGIN` | Allowed frontend origin |
| `EMAIL_QUEUE_NAME` | Shared BullMQ queue name; API and worker must use the same value |
| `WORKER_CONCURRENCY` | Maximum parallel jobs per worker instance |
| `API_INTERNAL_SECRET` | Authenticates trusted Next.js and worker requests |
| `SMTP_GATEWAY_URL` | Server-only Next.js route used by the worker for SMTP delivery |

### Frontend: `frontend/.env.local`

```dotenv
AUTH_SECRET="paste-the-auth-random-secret"
AUTH_URL="http://localhost:3000"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
BACKEND_API_URL="http://localhost:4000"
API_INTERNAL_SECRET="paste-the-same-shared-secret-as-backend"
ETHEREAL_SMTP_HOST="smtp.ethereal.email"
ETHEREAL_SMTP_PORT="587"
ETHEREAL_SMTP_USER="your-ethereal-username"
ETHEREAL_SMTP_PASS="your-ethereal-password"
```

`AUTH_URL` and `NEXTAUTH_URL` must be plain origins, such as `http://localhost:3000` or `https://your-domain.vercel.app`. Do not paste Markdown link syntax, add `/login`, or add `/api/auth`.

## Ethereal Email Setup

1. Open [Ethereal Email](https://ethereal.email/) and create or log into a test account.
2. Copy the SMTP username and password shown by Ethereal.
3. Set these frontend variables:

   ```dotenv
   ETHEREAL_SMTP_HOST="smtp.ethereal.email"
   ETHEREAL_SMTP_PORT="587"
   ETHEREAL_SMTP_USER="copied-ethereal-username"
   ETHEREAL_SMTP_PASS="copied-ethereal-password"
   ```

4. Restart the frontend after changing local variables, or redeploy after changing Vercel variables.
5. Schedule a message and wait for it to reach `SENT`.
6. Open the preview icon in the Sent Emails table, or sign in to Ethereal and inspect the Messages page.

Ethereal is a fake SMTP sandbox. It accepts messages and renders previews, but it does not deliver them to real Gmail, Outlook, or example.com inboxes. Recipient addresses may be ordinary syntactically valid addresses; they do not need to be Ethereal accounts.

## Google OAuth Setup

In Google Cloud Console, create an OAuth client of type **Web application**.

For local development, add:

```text
Authorized JavaScript origin: http://localhost:3000
Authorized redirect URI:      http://localhost:3000/api/auth/callback/google
```

For production, add the exact production domain:

```text
Authorized JavaScript origin: https://your-domain.vercel.app
Authorized redirect URI:      https://your-domain.vercel.app/api/auth/callback/google
```

The callback path and domain must match exactly. A `/login` URL or the bare site URL is not a valid callback URI.

## Run the Backend

### Option A: infrastructure in Docker, Node processes locally

Start PostgreSQL and Redis:

```bash
cd backend
docker compose up -d postgres redis
```

Install dependencies, generate Prisma Client, and apply committed migrations:

```bash
npm ci
npm run prisma:generate
npm run db:deploy
```

Run the Express API:

```bash
npm run dev
```

In a second terminal, run the BullMQ worker:

```bash
cd backend
npm run worker
```

The API is available at `http://localhost:4000`. Verify it with:

```bash
curl http://localhost:4000/health
```

The frontend must also be running because the worker sends through `SMTP_GATEWAY_URL`.

### Option B: run the complete stack with Docker

After creating both environment files:

```bash
cd backend
docker compose up --build
```

This starts:

- PostgreSQL with a named data volume;
- Redis with append-only persistence and a named data volume;
- a one-shot Prisma migration container;
- the Express API on port `4000`;
- the long-running BullMQ worker;
- the Next.js frontend on port `3000`.

Stop the stack without deleting data:

```bash
docker compose down
```

Do not add `-v` unless you intentionally want to delete the PostgreSQL and Redis volumes.

### Production backend commands

```bash
cd backend
npm ci
npm run build
npm run db:deploy
npm start
```

Run the worker as a separate long-running service built from the same commit:

```bash
npm run start:worker
```

The API and worker must share `DATABASE_URL`, `REDIS_URL`, `EMAIL_QUEUE_NAME`, and compatible `API_INTERNAL_SECRET` settings.

## Run the Frontend

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`, sign in with Google, and continue to the dashboard.

Production build:

```bash
npm run lint
npm run typecheck
npm run build
npm start
```

On Vercel, set the project root directory to `frontend`. Vercel runs the Next.js build and hosts the Auth.js routes, authenticated backend proxy, and server-only Ethereal SMTP gateway.

## API Summary

The browser calls `/api/backend/*` on Next.js. Next.js validates the session and forwards to Express. Direct Express requests require trusted internal headers.

| Method | Express route | Purpose |
|---|---|---|
| `GET` | `/health` | Public API health check |
| `POST` | `/api/auth/sync` | Create or update the authenticated user and sender |
| `GET` | `/api/senders` | List active sender accounts |
| `POST` | `/api/schedule` | Persist and enqueue a recipient batch |
| `GET` | `/api/scheduled?limit=50` | List scheduled, queued, sending, and retrying emails |
| `GET` | `/api/sent?limit=50` | List sent, failed, and cancelled emails |
| `DELETE` | `/api/emails/:emailId` | Cancel/remove an email when safe and delete its queue job |

## Verification

Run these checks before pushing or deploying:

```bash
cd backend
npm ci
npm run typecheck
npm run build
docker compose config --quiet

cd ../frontend
npm ci
npm run lint
npm run typecheck
npm run build
```
