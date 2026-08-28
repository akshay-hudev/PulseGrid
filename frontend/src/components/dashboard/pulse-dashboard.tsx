'use client';

import type { PaginatedEmails, SenderAccount, SenderList } from '@/lib/types';
import { Activity, CirclePlus, LogOut, Orbit, RefreshCw, Send, TimerReset } from 'lucide-react';
import Image from 'next/image';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ComposeModal } from './compose-modal';
import { EmailTable } from './email-table';
import { SignalField } from './signal-field';

interface PulseDashboardProps {
  user: { name: string; email: string; image: string | null };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Request failed');
  return payload;
}

export function PulseDashboard({ user }: PulseDashboardProps) {
  const [scheduled, setScheduled] = useState<PaginatedEmails>({ items: [], nextCursor: null });
  const [sent, setSent] = useState<PaginatedEmails>({ items: [], nextCursor: null });
  const [senders, setSenders] = useState<SenderAccount[]>([]);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationalDate, setOperationalDate] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [scheduledResponse, sentResponse, senderResponse] = await Promise.all([
        fetchJson<PaginatedEmails>('/api/backend/scheduled?limit=100'),
        fetchJson<PaginatedEmails>('/api/backend/sent?limit=100'),
        fetchJson<SenderList>('/api/backend/senders'),
      ]);
      setScheduled(scheduledResponse);
      setSent(sentResponse);
      setSenders(senderResponse.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reach scheduler');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      setOperationalDate(
        new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
        }).format(new Date()).toUpperCase(),
      );
      void refresh();
    }, 0);
    const interval = window.setInterval(() => void refresh(true), 5_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const sentCount = useMemo(
    () => sent.items.filter((email) => email.status === 'SENT').length,
    [sent.items],
  );
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <main className="dashboard-shell">
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-mark"><Orbit size={20} /> PULSEGRID <span>CONTROL</span></div>
        <div className="topbar-center"><i /> SYSTEM OPERATIONAL <span>{operationalDate || '\u00a0'}</span></div>
        <div className="operator-menu">
          <div className="avatar">
            {user.image ? <Image src={user.image} alt="" width={36} height={36} /> : initials}
          </div>
          <div><strong>{user.name}</strong><small>{user.email}</small></div>
          <button className="icon-button" onClick={() => void signOut({ redirectTo: '/login' })} aria-label="Log out"><LogOut size={16} /></button>
        </div>
      </header>

      <div className="dashboard-frame">
        <aside className="rail" aria-label="Workspace navigation">
          <button className="rail-button active" aria-label="Dispatch overview"><Activity size={18} /><span>01</span></button>
          <div className="rail-line" />
          <span className="rail-label">DISPATCH</span>
        </aside>

        <div className="dashboard-content">
          <section className="dashboard-intro">
            <div>
              <p className="eyebrow"><span /> OUTREACH COMMAND CENTER</p>
              <h1>Good signal, {user.name.split(' ')[0]}.</h1>
              <p>Monitor the queue fabric and launch precision-timed transmissions.</p>
            </div>
            <button className="compose-button" onClick={() => setComposeOpen(true)} disabled={!senders.length}>
              <CirclePlus size={18} /> Compose new email
            </button>
          </section>

          {error && <div className="global-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Retry connection</button></div>}

          <div className="metric-strip">
            <div><TimerReset size={18} /><span>On runway</span><strong>{scheduled.items.length.toString().padStart(2, '0')}</strong></div>
            <div><Send size={18} /><span>Delivered</span><strong>{sentCount.toString().padStart(2, '0')}</strong></div>
            <div><Activity size={18} /><span>Active senders</span><strong>{senders.length.toString().padStart(2, '0')}</strong></div>
            <button onClick={() => void refresh(true)} disabled={refreshing} className="refresh-button"><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> SYNC</button>
          </div>

          <SignalField emails={scheduled.items} sender={senders[0]} />

          <section className="manifest-panel">
            <header className="manifest-header">
              <div className="tabs" role="tablist">
                <button className={activeTab === 'scheduled' ? 'active' : ''} onClick={() => setActiveTab('scheduled')} role="tab">
                  Scheduled <span>{scheduled.items.length}</span>
                </button>
                <button className={activeTab === 'sent' ? 'active' : ''} onClick={() => setActiveTab('sent')} role="tab">
                  Sent archive <span>{sent.items.length}</span>
                </button>
              </div>
              <p>AUTO REFRESH · 5 SEC</p>
            </header>
            <EmailTable
              emails={activeTab === 'scheduled' ? scheduled.items : sent.items}
              loading={loading}
              mode={activeTab}
              onDeleted={() => refresh(true)}
            />
          </section>
        </div>
      </div>

      {composeOpen && (
        <ComposeModal senders={senders} onClose={() => setComposeOpen(false)} onScheduled={() => refresh(true)} />
      )}
    </main>
  );
}
