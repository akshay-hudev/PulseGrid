import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

interface SyncedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

async function syncUserWithBackend(user: {
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<SyncedUser> {
  const backendUrl = process.env.BACKEND_API_URL;
  const internalSecret = process.env.API_INTERNAL_SECRET;
  if (!backendUrl || !internalSecret) {
    throw new Error('Backend authentication bridge is not configured');
  }

  const response = await fetch(`${backendUrl}/api/auth/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-internal-secret': internalSecret,
    },
    body: JSON.stringify(user),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Unable to synchronize authenticated user (${response.status})`);
  }

  const payload = (await response.json()) as { user: SyncedUser };
  return payload.user;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) {
        const synced = await syncUserWithBackend({
          email: user.email,
          name: user.name,
          image: user.image,
        });
        token.pulsegridUserId = synced.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.pulsegridUserId === 'string') {
        session.user.id = token.pulsegridUserId;
      }
      return session;
    },
    authorized({ auth: session, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith('/dashboard')) return Boolean(session?.user);
      return true;
    },
  },
});
