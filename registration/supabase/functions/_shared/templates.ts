// Transactional email templates. Table layout + inline styles so they render in Gmail,
// Outlook (Word engine) and iOS Mail. Every template also has a plain-text twin.
import { APP_URL } from './constants.ts';
import type { EventRow, RegistrationRow } from './db.ts';

export type TemplateName = 'pending' | 'approved' | 'declined' | 'waitlisted';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const NAVY = '#193561';
const YELLOW = '#fbd960';
const BODY = '#334155';
const MUTED = '#64748b';

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function when(event: EventRow) {
  const tz = event.timezone;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(event.starts_at));
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  return { date, time: `${time(event.starts_at)} – ${time(event.ends_at)} (Manila time, UTC+8)` };
}

function detailsHtml(event: EventRow) {
  const { date, time } = when(event);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:${MUTED};font-size:14px;vertical-align:top;white-space:nowrap">${label}</td>` +
    `<td style="padding:4px 0;color:${BODY};font-size:14px">${value}</td></tr>`;
  const venue = esc(event.venue) + (event.venue_address ? `<br>${esc(event.venue_address)}` : '') +
    (event.map_url ? `<br><a href="${esc(event.map_url)}" style="color:${NAVY}">Open in Maps</a>` : '');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">` +
    row('Date', esc(date)) + row('Time', esc(time)) + row('Venue', venue) + `</table>`;
}

function detailsText(event: EventRow) {
  const { date, time } = when(event);
  return [
    `Date:  ${date}`,
    `Time:  ${time}`,
    `Venue: ${event.venue}${event.venue_address ? `, ${event.venue_address}` : ''}`,
    event.map_url ? `Map:   ${event.map_url}` : '',
  ].filter(Boolean).join('\n');
}

function button(href: string, label: string) {
  // Bulletproof-ish button: a padded table cell works in Outlook where <a> padding doesn't.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr>` +
    `<td style="background:${NAVY};border-radius:8px;padding:12px 22px">` +
    `<a href="${esc(href)}" style="color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">${esc(label)}</a>` +
    `</td></tr></table>`;
}

function layout(event: EventRow, preheader: string, inner: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(event.name)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#ffffff;padding:20px 28px;border-bottom:1px solid #e2e8f0">
  <img src="${APP_URL}/brand/logo.png" alt="Youth Innovations Marketplace" width="180" style="display:block;border:0;max-width:180px;height:auto">
</td></tr>
<tr><td style="height:4px;background:${YELLOW};line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px;color:${BODY};font-size:15px;line-height:1.6">
${inner}
</td></tr>
<tr><td style="padding:20px 28px;background:#f8fafc;color:${MUTED};font-size:12px;line-height:1.5">
  <strong style="color:${NAVY}">${esc(event.name)}</strong> — ${esc(event.subtitle)}<br>
  A satellite event of the 2nd Global Ministerial Conference on Ending Violence Against Children.<br>
  Co-convened by the Global Youth-Led Movement on EVAC, Terre des Hommes Netherlands and Kindernothilfe.<br><br>
  Questions? Reply to this email or write to <a href="mailto:${esc(event.contact_email)}" style="color:${NAVY}">${esc(event.contact_email)}</a>.<br>
  Your personal data is processed under the Philippine Data Privacy Act (RA 10173) and only for organizing this event.
</td></tr>
</table></td></tr></table></body></html>`;
}

const textFooter = (event: EventRow) =>
  `\n\n—\n${event.name} — ${event.subtitle ?? ''}\nQuestions? Write to ${event.contact_email}\n`;

export function renderEmail(
  template: TemplateName,
  reg: RegistrationRow,
  event: EventRow,
  ticketLink: string,
  qrCid?: string,
): RenderedEmail {
  const first = reg.preferred_name || reg.full_name.split(/\s+/)[0] || reg.full_name;
  const hi = `<p style="margin:0 0 12px">Hi ${esc(first)},</p>`;
  const h1 = (s: string) => `<h1 style="margin:0 0 16px;color:${NAVY};font-size:22px;line-height:1.3">${esc(s)}</h1>`;

  switch (template) {
    case 'pending': {
      const summary = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;background:#f0f4fa;border-radius:8px;width:100%">
<tr><td style="padding:14px 16px;font-size:14px;color:${BODY}">
<strong>Name:</strong> ${esc(reg.full_name)}<br>
<strong>Organization:</strong> ${esc(reg.organization) || '—'}<br>
<strong>Category:</strong> ${esc(reg.category) || '—'}</td></tr></table>`;
      return {
        subject: `Your registration is pending — ${event.name}`,
        html: layout(event, 'We received your registration and it is under review.',
          h1('Registration received') + hi +
          `<p style="margin:0 0 12px">Thank you for registering for <strong>${esc(event.name)}</strong>. Your request has been received and is now <strong>being reviewed by the organizers</strong>.</p>` +
          `<p style="margin:0 0 12px">Once you're approved, we'll send you another email with your personal <strong>QR ticket</strong>. You don't need to do anything else for now.</p>` +
          summary + detailsHtml(event) +
          button(ticketLink, 'Check your registration status')),
        text: `Hi ${first},\n\nThank you for registering for ${event.name}. Your request has been received and is being reviewed by the organizers.\n\nOnce you're approved, we'll send you another email with your personal QR ticket.\n\nWhat you submitted:\nName: ${reg.full_name}\nOrganization: ${reg.organization ?? '—'}\nCategory: ${reg.category ?? '—'}\n\n${detailsText(event)}\n\nCheck your status: ${ticketLink}` + textFooter(event),
      };
    }

    case 'approved': {
      const qr = qrCid
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto"><tr><td align="center" style="padding:12px;border:2px solid #e2e8f0;border-radius:12px">
<img src="cid:${qrCid}" alt="Your QR ticket" width="240" height="240" style="display:block;border:0;width:240px;height:240px">
</td></tr><tr><td align="center" style="padding-top:8px;color:${MUTED};font-size:13px">Show this code at the registration desk</td></tr></table>`
        : '';
      return {
        subject: `You're confirmed — ${event.name}`,
        html: layout(event, 'Your registration is approved. Your QR ticket is inside.',
          h1("You're confirmed!") + hi +
          `<p style="margin:0 0 12px">Great news — your registration for <strong>${esc(event.name)}</strong> has been <strong>approved</strong>. Here is your personal QR ticket.</p>` +
          qr + detailsHtml(event) +
          `<p style="margin:16px 0 8px;color:${NAVY};font-weight:bold">What to bring</p>` +
          `<ul style="margin:0 0 12px;padding-left:20px"><li>This QR code — on your phone or printed</li><li>A valid photo ID</li></ul>` +
          (event.arrival_note ? `<p style="margin:0 0 12px">${esc(event.arrival_note)}</p>` : '') +
          `<p style="margin:0 0 12px">A calendar invite (.ics) is attached. If the QR code doesn't display, open your ticket page:</p>` +
          button(ticketLink, 'Open my ticket') +
          `<p style="margin:0;color:${MUTED};font-size:13px">This ticket is personal — please don't share it.</p>`),
        text: `Hi ${first},\n\nYour registration for ${event.name} has been approved.\n\nYour QR ticket: ${ticketLink}\n(Open the link and show the QR code at the registration desk.)\n\n${detailsText(event)}\n\nWhat to bring:\n- Your QR code (on your phone or printed)\n- A valid photo ID\n${event.arrival_note ? `\n${event.arrival_note}\n` : ''}\nA calendar invite is attached. This ticket is personal — please don't share it.` + textFooter(event),
      };
    }

    case 'declined': {
      const reason = reg.decline_reason
        ? `<p style="margin:0 0 12px;padding:12px 16px;background:#f8fafc;border-left:4px solid #cbd5e1"><strong>Note from the organizers:</strong> ${esc(reg.decline_reason)}</p>`
        : '';
      return {
        subject: `Update on your registration — ${event.name}`,
        html: layout(event, 'An update on your registration.',
          h1('Update on your registration') + hi +
          `<p style="margin:0 0 12px">Thank you for your interest in <strong>${esc(event.name)}</strong>. Unfortunately, we're unable to confirm your attendance this time.</p>` +
          reason +
          `<p style="margin:0 0 12px">Venue capacity is limited and we have had to prioritise certain participant groups. If you think this is a mistake, please contact us at <a href="mailto:${esc(event.contact_email)}" style="color:${NAVY}">${esc(event.contact_email)}</a>.</p>` +
          `<p style="margin:0">Thank you for your support in ending violence against children.</p>`),
        text: `Hi ${first},\n\nThank you for your interest in ${event.name}. Unfortunately, we're unable to confirm your attendance this time.\n${reg.decline_reason ? `\nNote from the organizers: ${reg.decline_reason}\n` : ''}\nIf you think this is a mistake, please contact us at ${event.contact_email}.\n\nThank you for your support in ending violence against children.` + textFooter(event),
      };
    }

    case 'waitlisted':
      return {
        subject: `You're on the waitlist — ${event.name}`,
        html: layout(event, 'The event is currently full — you are on the waitlist.',
          h1("You're on the waitlist") + hi +
          `<p style="margin:0 0 12px">Thank you for registering for <strong>${esc(event.name)}</strong>. The event is currently at capacity, so we've placed you on the <strong>waitlist</strong>.</p>` +
          `<p style="margin:0 0 12px">If a place opens up and your registration is approved, you'll receive an email with your QR ticket. Please don't come to the venue without one.</p>` +
          detailsHtml(event) + button(ticketLink, 'Check your registration status')),
        text: `Hi ${first},\n\nThank you for registering for ${event.name}. The event is currently at capacity, so you're on the waitlist.\n\nIf a place opens up and you're approved, you'll receive an email with your QR ticket. Please don't come to the venue without one.\n\n${detailsText(event)}\n\nCheck your status: ${ticketLink}` + textFooter(event),
      };
  }
}
