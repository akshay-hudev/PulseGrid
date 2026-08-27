import { auth } from '@/auth';
import { PulseDashboard } from '@/components/dashboard/pulse-dashboard';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <PulseDashboard
      user={{
        name: session.user.name ?? 'Operator',
        email: session.user.email ?? '',
        image: session.user.image ?? null,
      }}
    />
  );
}
