'use client';

import type { EmailRecord, SenderAccount } from '@/lib/types';
import { Gauge, Radio, Zap } from 'lucide-react';

interface SignalFieldProps {
  emails: EmailRecord[];
  sender?: SenderAccount;
}

export function SignalField({ emails, sender }: SignalFieldProps) {
  const visibleSignals = emails.slice(0, 7);
  const queued = emails.filter((email) => email.status !== 'SENDING').length;
  const sending = emails.filter((email) => email.status === 'SENDING').length;

  return (
    <section className="signal-field" aria-label="Email queue activity">
      <div className="signal-grid" aria-hidden="true" />
      <header>
        <div>
          <p className="eyebrow"><span /> QUEUE ACTIVITY</p>
          <h2>What the worker is doing</h2>
        </div>
        <div className="live-pill"><i /> LIVE</div>
      </header>

      <div className="runway">
        <div className="runway-node origin"><Zap size={16} /><span>QUEUE</span></div>
        <div className="runway-line">
          {visibleSignals.map((email, index) => (
            <span
              className={`signal signal-${email.status.toLowerCase()}`}
              style={{ '--signal-index': index } as React.CSSProperties}
              key={email.id}
              title={`${email.toEmail} · ${email.status}`}
            />
          ))}
          {visibleSignals.length === 0 && <span className="runway-idle">NO EMAILS WAITING</span>}
        </div>
        <div className="runway-node destination"><Radio size={16} /><span>SENT</span></div>
      </div>

      <footer className="runway-stats">
        <div><span>Waiting</span><strong>{queued.toString().padStart(2, '0')}</strong></div>
        <div><span>Sending now</span><strong>{sending.toString().padStart(2, '0')}</strong></div>
        <div><span>Hourly limit</span><strong>{sender?.hourlyLimit ?? 0}<small>/HR</small></strong></div>
        <div className="capacity-gauge"><Gauge size={16} /><span>{sender ? `${sender.minDelayMs / 1000}s spacing` : 'No sender'}</span></div>
      </footer>
    </section>
  );
}
