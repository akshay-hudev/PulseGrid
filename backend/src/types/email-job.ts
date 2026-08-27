export const EMAIL_JOB_NAME = 'send-email' as const;

export interface EmailJobData {
  emailId: string;
}

export interface EmailJobResult {
  emailId: string;
  messageId: string;
  sentAt: string;
}
