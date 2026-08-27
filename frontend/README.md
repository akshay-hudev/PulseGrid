# PulseGrid Command Center

Next.js 16, React 19, TypeScript, Tailwind CSS 4, and Auth.js frontend for the PulseGrid email scheduler.

## Run locally

Copy `.env.example` to `.env.local`, configure Google OAuth and the backend bridge, then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The OAuth callback URI is `http://localhost:3000/api/auth/callback/google`. The backend API must be running at the configured `BACKEND_API_URL` because successful Google sign-in synchronizes the authenticated user and creates their first sender account.

## Commands

```bash
npm run lint
npm run build
npm start
```

The browser talks only to authenticated Next.js route handlers under `/api/backend/*`. Those server-side handlers forward the Auth.js user ID and internal service secret to Express; neither value can be supplied by browser form data.
