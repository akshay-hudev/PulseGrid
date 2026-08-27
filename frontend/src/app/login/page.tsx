import { signIn } from '@/auth';
import { Activity, ArrowRight, Orbit, RadioTower } from 'lucide-react';

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="noise" aria-hidden="true" />
      <section className="login-stage">
        <div className="brand-mark"><Orbit size={21} /> PULSEGRID</div>
        <div className="login-copy">
          <p className="eyebrow"><span /> EMAIL DELIVERY INFRASTRUCTURE</p>
          <h1>Every message.<br /><em>Right on time.</em></h1>
          <p className="login-lede">
            A resilient dispatch layer for scheduling, throttling, and observing
            high-volume email delivery in real time.
          </p>
          <div className="system-readout">
            <div><RadioTower size={16} /><span>Queue fabric</span><strong>ONLINE</strong></div>
            <div><Activity size={16} /><span>Delivery state</span><strong>READY</strong></div>
          </div>
        </div>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/dashboard' });
          }}
          className="login-card"
        >
          <span className="card-index">PG / AUTH-01</span>
          <div className="google-glyph" aria-hidden="true">G</div>
          <h2>Enter command center</h2>
          <p>Authenticate with your Google workspace to access the dispatch network.</p>
          <button type="submit" className="primary-action">
            Continue with Google <ArrowRight size={17} />
          </button>
          <small>OAuth 2.0 · Encrypted session · No password stored</small>
        </form>
      </section>
    </main>
  );
}
