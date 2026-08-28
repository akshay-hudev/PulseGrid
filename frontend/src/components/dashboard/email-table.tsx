'use client';

import type { EmailRecord } from '@/lib/types';
import { ExternalLink, Inbox, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

interface EmailTableProps {
  emails: EmailRecord[];
  loading: boolean;
  mode: 'scheduled' | 'sent';
  onDeleted: () => void | Promise<void>;
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

export function EmailTable({ emails, loading, mode, onDeleted }: EmailTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteEmail(email: EmailRecord): Promise<void> {
    if (!window.confirm(`Delete the email to ${email.toEmail}? This cannot be undone.`)) return;
    setDeletingId(email.id);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/backend/emails/${email.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Unable to delete email');
      }
      await onDeleted();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete email');
    } finally {
      setDeletingId(null);
    }
  }

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
      {deleteError && <p className="table-error" role="alert">{deleteError}</p>}
      <table className="manifest-table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Transmission</th>
            <th>{mode === 'scheduled' ? 'Scheduled' : 'Sent'}</th>
            <th>Status</th>
            <th aria-label="Actions" />
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
                <div className="row-actions">
                  {email.previewUrl ? (
                    <a className="icon-link" href={email.previewUrl} target="_blank" rel="noreferrer" aria-label="Open Ethereal preview">
                      <ExternalLink size={15} />
                    </a>
                  ) : email.lastError ? (
                    <span className="error-hint" title={email.lastError}><TriangleAlert size={15} /></span>
                  ) : null}
                  <button
                    className="delete-email-button"
                    type="button"
                    onClick={() => void deleteEmail(email)}
                    disabled={deletingId === email.id || email.status === 'SENDING'}
                    aria-label={`Delete email to ${email.toEmail}`}
                    title={email.status === 'SENDING' ? 'Cannot delete while sending' : 'Delete email'}
                  >
                    {deletingId === email.id ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
