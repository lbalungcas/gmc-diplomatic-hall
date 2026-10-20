// Email provider wrapper. Everything else talks to `emailProvider`, so swapping Resend for
// another service (Postmark, SES, SMTP relay…) means adding one class here.

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file contents. */
  content: string;
  contentType: string;
  /** Set to reference the attachment inline as <img src="cid:…">. */
  contentId?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface SendResult {
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  send(message: OutgoingEmail): Promise<SendResult>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ResendProvider implements EmailProvider {
  // Resend's default limit is 2 requests/second per team; space sends out so bulk approvals don't 429.
  private nextSlot = 0;
  private readonly minIntervalMs = Number(Deno.env.get('EMAIL_MIN_INTERVAL_MS') ?? 550);

  constructor(private apiKey: string, private from: string) {}

  async send(message: OutgoingEmail): Promise<SendResult> {
    const payload = {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
        content_id: a.contentId,
      })),
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextSlot = Date.now() + this.minIntervalMs;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json();
        return { status: 'sent', messageId: body.id };
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return { status: 'failed', error: `Resend ${res.status}: ${(await res.text()).slice(0, 500)}` };
    }
    return { status: 'failed', error: 'Resend: gave up after 3 attempts (rate limited or unavailable)' };
  }
}

/** Used when RESEND_API_KEY is unset (local dev): logs instead of sending. */
class ConsoleProvider implements EmailProvider {
  send(message: OutgoingEmail): Promise<SendResult> {
    console.log(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return Promise.resolve({ status: 'skipped', error: 'RESEND_API_KEY not set — email logged, not sent' });
  }
}

const resendKey = Deno.env.get('RESEND_API_KEY');

export const emailProvider: EmailProvider = resendKey
  ? new ResendProvider(
      resendKey,
      // RESEND_FROM_EMAIL: the sender the hall project already set up in Resend.
      Deno.env.get('EMAIL_FROM') ??
        Deno.env.get('RESEND_FROM_EMAIL') ??
        'Youth Innovations Marketplace <register@youthinnovationsmarketplace.org>',
    )
  : new ConsoleProvider();
