import { timingSafeEqual } from 'node:crypto';
import nodemailer, { getTestMessageUrl } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface DeliveryRequest {
  emailId: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

function isNonEmptyString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function parseDeliveryRequest(value: unknown): DeliveryRequest | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    !isNonEmptyString(body.emailId, 100)
    || !isNonEmptyString(body.fromEmail, 320)
    || !isNonEmptyString(body.fromName, 200)
    || !isNonEmptyString(body.toEmail, 320)
    || !isNonEmptyString(body.subject, 998)
    || !isNonEmptyString(body.textBody, 1_000_000)
    || (body.htmlBody !== undefined && !isNonEmptyString(body.htmlBody, 2_000_000))
  ) {
    return null;
  }
  return body as unknown as DeliveryRequest;
}

function secretsMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

function smtpConfiguration(): { options: SMTPTransport.Options; user: string } {
  const host = process.env.ETHEREAL_SMTP_HOST ?? 'smtp.ethereal.email';
  const port = Number(process.env.ETHEREAL_SMTP_PORT ?? '587');
  const user = process.env.ETHEREAL_SMTP_USER;
  const pass = process.env.ETHEREAL_SMTP_PASS;
  if (!user || !pass || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP gateway environment is not configured');
  }
  return {
    user,
    options: {
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 45_000,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!secretsMatch(request.headers.get('x-api-internal-secret'), process.env.API_INTERNAL_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const delivery = parseDeliveryRequest(await request.json().catch(() => null));
  if (!delivery) {
    return Response.json({ error: 'Invalid delivery payload' }, { status: 400 });
  }

  try {
    const configuration = smtpConfiguration();
    const transporter = nodemailer.createTransport(configuration.options);
    const info = await transporter.sendMail({
      envelope: { from: configuration.user, to: delivery.toEmail },
      from: { name: delivery.fromName, address: delivery.fromEmail },
      to: delivery.toEmail,
      subject: delivery.subject,
      text: delivery.textBody,
      ...(delivery.htmlBody ? { html: delivery.htmlBody } : {}),
      headers: { 'X-PulseGrid-Email-Id': delivery.emailId },
    });

    if (info.accepted.length === 0 || info.rejected.length > 0) {
      throw new Error(`SMTP rejected recipient: ${info.rejected.join(', ') || delivery.toEmail}`);
    }

    return Response.json({
      messageId: info.messageId,
      previewUrl: getTestMessageUrl(info as unknown as SMTPTransport.SentMessageInfo) || null,
    });
  } catch (error) {
    console.error('Ethereal delivery failed', {
      emailId: delivery.emailId,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: 'Ethereal delivery failed' }, { status: 502 });
  }
}
