import { signIn } from '@/auth';
import { ArrowRight, Check, Clock3, Orbit } from 'lucide-react';

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="noise" aria-hidden="true" />
      <section className="login-stage">
        <div className="brand-mark"><Orbit size={21} /> PULSEGRID</div>
        <div className="login-copy">
          <p className="eyebrow"><span /> EMAIL SCHEDULER</p>
          <h1>Send the list.<br /><em>At the right time.</em></h1>
          <p className="login-lede">
            Upload recipients, choose a start time, and watch each email move
            through the queue. That&apos;s it.
          </p>
          <div className="system-readout">
            <div><Clock3 size={16} /><span>Delayed scheduling</span><strong>READY</strong></div>
            <div><Check size={16} /><span>Send history</span><strong>INCLUDED</strong></div>
          </div>
        </div>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/dashboard' });
          }}
          className="login-card"
        >
          <span className="card-index">SIGN IN</span>
          <div className="google-glyph" aria-hidden="true">G</div>
          <h2>Open your email queue</h2>
          <p>Use Google to sign in. We only use your account for authentication.</p>
          <button type="submit" className="primary-action">
            Continue with Google <ArrowRight size={17} />
          </button>
          <small>OAuth 2.0 · We do not store your Google password</small>
        </form>
      </section>
    </main>
  );
}
