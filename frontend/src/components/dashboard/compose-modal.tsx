'use client';

import type { SenderAccount } from '@/lib/types';
import { ArrowRight, Check, FileUp, Radio, Send, X } from 'lucide-react';
import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

interface ComposeModalProps {
  senders: SenderAccount[];
  onClose: () => void;
  onScheduled: () => Promise<void>;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function defaultStartTime(): string {
  const date = new Date(Date.now() + 5 * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function ComposeModal({ senders, onClose, onScheduled }: ComposeModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senderAccountId, setSenderAccountId] = useState(senders[0]?.id ?? '');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(senders[0]?.hourlyLimit ?? 200);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSender = useMemo(
    () => senders.find((sender) => sender.id === senderAccountId),
    [senderAccountId, senders],
  );

  async function readLeads(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Lead file must be smaller than 5 MB.');
      return;
    }
    const content = await file.text();
    const detected = content.match(EMAIL_PATTERN) ?? [];
    const unique = [...new Set(detected.map((email) => email.toLowerCase()))];
    setRecipients(unique);
    setFileName(file.name);
    setError(unique.length ? null : 'No valid email addresses were detected.');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!senderAccountId || recipients.length === 0) {
      setError('Choose a sender and upload at least one valid recipient.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/backend/schedule', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          senderAccountId,
          recipients,
          subject,
          body,
          startTime: new Date(startTime).toISOString(),
          delayBetweenEmailsMs: delaySeconds * 1_000,
          hourlyLimit,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to schedule emails');
      await onScheduled();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to schedule emails');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header>
          <div><span className="card-index">PG / NEW TRANSMISSION</span><h2 id="compose-title">Compose dispatch</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close compose dialog"><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="compose-grid">
            <div className="compose-main">
              <label>Sender channel
                <select value={senderAccountId} onChange={(event) => setSenderAccountId(event.target.value)} required>
                  {senders.map((sender) => <option value={sender.id} key={sender.id}>{sender.displayName ?? sender.email} · {sender.email}</option>)}
                </select>
              </label>
              <label>Subject line
                <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={998} placeholder="A signal worth opening" required />
              </label>
              <label>Message body
                <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={9} placeholder="Write your transmission…" required />
              </label>
              <label className={`file-drop ${recipients.length ? 'file-ready' : ''}`}>
                <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void readLeads(event)} />
                {recipients.length ? <Check size={21} /> : <FileUp size={21} />}
                <span><strong>{fileName || 'Upload lead manifest'}</strong><small>{recipients.length ? `${recipients.length} unique addresses detected` : 'CSV or text · up to 5 MB'}</small></span>
              </label>
            </div>
            <aside className="launch-controls">
              <p className="eyebrow"><span /> LAUNCH PARAMETERS</p>
              <label>Start time<input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
              <label>Signal spacing<div className="unit-input"><input type="number" min="1" max="3600" value={delaySeconds} onChange={(event) => setDelaySeconds(Number(event.target.value))} required /><span>SEC</span></div></label>
              <label>Hourly ceiling<div className="unit-input"><input type="number" min="1" max="10000" value={hourlyLimit} onChange={(event) => setHourlyLimit(Number(event.target.value))} required /><span>/ HR</span></div></label>
              <div className="launch-summary"><Radio size={16} /><span>Channel</span><strong>{selectedSender?.email ?? 'Unavailable'}</strong></div>
              <div className="launch-summary"><ArrowRight size={16} /><span>Recipients</span><strong>{recipients.length}</strong></div>
            </aside>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer>
            <button type="button" className="secondary-action" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-action" disabled={submitting || senders.length === 0}>
              {submitting ? 'Scheduling…' : 'Launch dispatch'} <Send size={16} />
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
