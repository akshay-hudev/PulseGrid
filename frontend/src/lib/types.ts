export type EmailStatus =
  | 'SCHEDULED'
  | 'QUEUED'
  | 'SENDING'
  | 'RETRYING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

export interface EmailRecord {
  id: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  attemptCount: number;
  lastError: string | null;
  previewUrl: string | null;
}

export interface SenderAccount {
  id: string;
  email: string;
  displayName: string | null;
  hourlyLimit: number;
  minDelayMs: number;
}

export interface PaginatedEmails {
  items: EmailRecord[];
  nextCursor: string | null;
}

export interface SenderList {
  items: SenderAccount[];
}
