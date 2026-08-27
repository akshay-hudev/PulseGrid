'use client';

import type { EmailRecord } from '@/lib/types';
import { ExternalLink, Inbox, TriangleAlert } from 'lucide-react';

interface EmailTableProps {
  emails: EmailRecord[];
  loading: boolean;
  mode: 'scheduled' | 'sent';
}

const statusClass: Record<EmailRecord['status'], string> = {
  SCHEDULED: 'status-scheduled',
  QUEUED: 'status-queued',
  SENDING: 'status-sending',
  RETRYING: 'status-retrying',
  SENT: 'status-sent',
  FAILED: 'status-failed',
  CANCELLED: 'status-failed',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function EmailTable({ emails, loading, mode }: EmailTableProps) {
  if (loading) {
    return (
      <div className="table-skeleton" aria-label="Loading emails">
        {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="empty-state">
        <div><Inbox size={23} /></div>
        <h3>{mode === 'scheduled' ? 'The runway is clear' : 'No transmissions yet'}</h3>
        <p>
          {mode === 'scheduled'
            ? 'Compose a dispatch to place your first emails on the timeline.'
            : 'Delivered and failed transmissions will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="manifest-wrap">
      <table className="manifest-table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Transmission</th>
            <th>{mode === 'scheduled' ? 'Scheduled' : 'Sent'}</th>
            <th>Status</th>
            <th aria-label="Details" />
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => (
            <tr key={email.id}>
              <td><strong>{email.toEmail}</strong><small>{email.fromEmail}</small></td>
              <td><span className="subject-cell">{email.subject}</span></td>
              <td><time>{formatDate(mode === 'scheduled' ? email.scheduledAt : email.sentAt)}</time></td>
              <td>
                <span className={`status-chip ${statusClass[email.status]}`}>
                  <i />{email.status.toLowerCase()}
                </span>
              </td>
              <td>
                {email.previewUrl ? (
                  <a className="icon-link" href={email.previewUrl} target="_blank" rel="noreferrer" aria-label="Open Ethereal preview">
                    <ExternalLink size={15} />
                  </a>
                ) : email.lastError ? (
                  <span className="error-hint" title={email.lastError}><TriangleAlert size={15} /></span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
