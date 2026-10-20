import { ticketUrl } from './constants.ts';
import { db, type EventRow, type RegistrationRow } from './db.ts';
import { emailProvider, type EmailAttachment, type SendResult } from './email.ts';
import { buildIcs, icsBase64 } from './ics.ts';
import { qrPngBase64 } from './qr.ts';
import { renderEmail, type TemplateName } from './templates.ts';

/** The email that matches a registration's current status (used by "Resend email"). */
export function templateForStatus(status: RegistrationRow['status']): TemplateName | null {
  switch (status) {
    case 'pending':
    case 'approved':
    case 'declined':
    case 'waitlisted':
      return status;
    default:
      return null;
  }
}

/**
 * Renders, sends and logs one status email. Never throws — a failed send is recorded in
 * email_log (visible in the admin drawer) so the decision itself is never rolled back.
 */
export async function sendStatusEmail(
  reg: RegistrationRow,
  event: EventRow,
  template: TemplateName,
  isResend = false,
): Promise<SendResult> {
  const link = ticketUrl(reg.ticket_token);
  let result: SendResult;
  try {
    const attachments: EmailAttachment[] = [];
    let qrCid: string | undefined;
    // The QR only ever leaves the server once the registration is approved.
    if (template === 'approved') {
      qrCid = 'ticket-qr';
      attachments.push(
        { filename: 'ticket-qr.png', content: await qrPngBase64(link), contentType: 'image/png', contentId: qrCid },
        { filename: 'youth-innovations-marketplace.ics', content: icsBase64(buildIcs(event, reg.id, link)), contentType: 'text/calendar' },
      );
    }
    const email = renderEmail(template, reg, event, link, qrCid);
    result = await emailProvider.send({
      to: reg.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: event.contact_email,
      attachments,
    });
  } catch (err) {
    result = { status: 'failed', error: String(err).slice(0, 500) };
  }

  const { error } = await db.from('email_log').insert({
    registration_id: reg.id,
    type: isResend ? 'resend' : template,
    template,
    to_email: reg.email,
    provider_message_id: result.messageId ?? null,
    status: result.status,
    error: result.error ?? null,
  });
  if (error) console.error('email_log insert failed', error);
  return result;
}
