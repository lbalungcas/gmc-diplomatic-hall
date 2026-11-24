// Transactional email templates. Table layout + inline styles so they render in Gmail,
// Outlook (Word engine) and iOS Mail. Every template also has a plain-text twin.
import { APP_URL, DIGITAL_MARKETPLACE_URL, ORGANIZERS, PARTNERSHIP_EMAIL, SAFEGUARDING_FORM_URL } from './constants.ts';
import type { EventRow, RegistrationRow } from './db.ts';

export type TemplateName = 'pending' | 'approved' | 'declined' | 'waitlisted' | 'safeguarding';

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
  Co-convened by Violence Ends With Us (VEWU), Terre des Hommes Netherlands and Kindernothilfe.<br><br>
  Questions? Reply to this email or write to <a href="mailto:${esc(event.contact_email)}" style="color:${NAVY}">${esc(event.contact_email)}</a>.<br>
  Your personal data is processed under the Philippine Data Privacy Act (RA 10173) and only for organizing this event.
</td></tr>
</table></td></tr></table></body></html>`;
}

const SAFEGUARDING_LINE =
  'The organizers take the safeguarding of children seriously. All attendees are required to read the Child Safeguarding Policy and Code of Conduct and confirm that they will abide by it.';

function safeguardingBlockHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;width:100%;background:#fff8dc;border-left:4px solid ${YELLOW}">` +
    `<tr><td style="padding:14px 16px;font-size:14px;color:${BODY}">` +
    `<strong style="color:${NAVY}">Required before you attend: Child Safeguarding and Code of Conduct</strong><br>` +
    `${esc(SAFEGUARDING_LINE)} Please complete the form before the event.` +
    button(SAFEGUARDING_FORM_URL, 'Complete the safeguarding form') +
    `</td></tr></table>`;
}

const safeguardingBlockText = () =>
  `\nRequired before you attend: Child Safeguarding and Code of Conduct\n${SAFEGUARDING_LINE} Please complete the form before the event:\n${SAFEGUARDING_FORM_URL}\n`;

const textFooter = (event: EventRow) =>
  `\n\n—\n${event.name} — ${event.subtitle ?? ''}\nQuestions? Write to ${event.contact_email}\n`;

export type AwardKind = 'mpyi' | 'peoples_choice';

const BALLOT_COPY: Record<AwardKind, { title: string; intro: string; ask: string }> = {
  mpyi: {
    title: 'Most Promising Young Innovator',
    intro: 'As one of the youth innovators at the Marketplace, you get one vote for the fellow innovator you think is the <strong>Most Promising Young Innovator</strong>.',
    ask: 'Pick the innovator from the list of names, check their details, and tell us why if you like. You can\'t vote for yourself.',
  },
  peoples_choice: {
    title: "People's Choice of Innovation",
    intro: "Thank you for visiting the Marketplace! You get one vote for the booth you think deserves the <strong>People's Choice of Innovation</strong> award.",
    ask: 'It takes less than a minute: tap the booth on the hall map and press Vote.',
  },
};

export type BallotVariant = 'invite' | 'reminder' | 'checkout';

/** The emailed ballot link. Each link is personal and works for one vote. */
export function renderBallotEmail(
  kind: AwardKind,
  name: string | null,
  event: EventRow,
  link: string,
  variant: BallotVariant = 'invite',
): RenderedEmail {
  const copy = BALLOT_COPY[kind];
  const first = (name ?? '').trim().split(/\s+/)[0] || 'there';
  const plainIntro = copy.intro.replace(/<\/?strong>/g, '');
  const subject = {
    invite: `Cast your vote: ${copy.title}`,
    reminder: `Reminder: cast your vote for ${copy.title}`,
    checkout: `Thanks for coming! Vote for ${copy.title}`,
  }[variant];
  const lead = {
    invite: '',
    reminder: "You haven't voted yet. Voting closes soon.",
    checkout: 'Safe travels home! Before you forget: which booth impressed you most?',
  }[variant];
  return {
    subject: `${subject} - ${event.name}`,
    html: layout(event, `Your personal ballot for ${copy.title}. One vote per person.`,
      `<h1 style="margin:0 0 16px;color:${NAVY};font-size:22px;line-height:1.3">${esc(copy.title)}</h1>` +
      `<p style="margin:0 0 12px">Hi ${esc(first)},</p>` +
      (lead ? `<p style="margin:0 0 12px">${esc(lead)}</p>` : '') +
      `<p style="margin:0 0 12px">${copy.intro}</p>` +
      `<p style="margin:0 0 12px">${esc(copy.ask)}</p>` +
      button(link, kind === 'peoples_choice' ? 'Vote for a booth' : 'Open my ballot') +
      `<p style="margin:0 0 12px;color:${MUTED};font-size:13px">This link is personal and works for one vote only, so please don't forward it. If the button doesn't work, copy this link into your browser:<br><a href="${esc(link)}" style="color:${NAVY};word-break:break-all">${esc(link)}</a></p>`),
    text: `Hi ${first},\n\n${lead ? `${lead}\n\n` : ''}${plainIntro}\n\n${copy.ask}\n\nOpen your ballot: ${link}\n\nThis link is personal and works for one vote only, so please don't forward it.` + textFooter(event),
  };
}

/**
 * Who a thank-you email is for: someone who came on the day (checked in at the door), or someone
 * who registered but we never got to welcome. The two only differ in the opening.
 */
export type ThankYouVariant = 'attended' | 'registered';

/**
 * The post-event thank-you. Thanks the person, invites them to the Digital Marketplace (the 3D hall
 * with every booth from the 17th), offers an introduction to any team, and credits the organizers
 * with their logo lock-up and links.
 */
export function renderThankYouEmail(name: string | null, event: EventRow, variant: ThankYouVariant): RenderedEmail {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'there';
  const p = (html: string, style = '') => `<p style="margin:0 0 14px${style}">${html}</p>`;
  const h2 = (s: string) => `<h2 style="margin:26px 0 10px;color:${NAVY};font-size:18px;line-height:1.3">${esc(s)}</h2>`;
  const mail = `<a href="mailto:${esc(PARTNERSHIP_EMAIL)}" style="color:${NAVY};font-weight:bold">${esc(PARTNERSHIP_EMAIL)}</a>`;

  const opening = variant === 'attended'
    ? {
      title: 'Thank you for being with us',
      html: [
        `On 17 November, the Diplomatic Hall was filled with young people who have spent months, and some of them years, building ways to keep children safe. Thank you for coming to listen to them, ask them questions and take their ideas seriously.`,
        `That matters more than you might think. For many of the youth innovators, it was the first time they presented their work to policymakers, partners and peers from around the world. Whether you stopped at one booth or all twenty-four, cast a vote, or had a conversation that stayed with you, you were part of what made the day work.`,
      ],
    }
    : {
      title: 'Thank you for registering',
      html: [
        `Thank you for registering for the Youth Innovations Marketplace on 17 November. We're sorry we didn't get to welcome you in person, but your interest means a great deal to the young people behind these innovations.`,
        `The good news is that the Marketplace isn't over. Everything the youth innovators shared on the day is still there for you to explore.`,
      ],
    };

  const marketplaceHtml =
    h2(variant === 'attended' ? 'Revisit the booths, or see the ones you missed' : 'Visit the Marketplace online') +
    p(`All 24 youth-led booths from the 17th are in the <strong>Digital Marketplace</strong>. Walk the hall in 3D, read each team's poster, and learn how young people are tackling online child sexual exploitation and abuse, child labour, corporal punishment, and child, early and forced marriage.`) +
    button(DIGITAL_MARKETPLACE_URL, 'Visit the Digital Marketplace') +
    p(`It works on a phone, tablet or computer, and there's nothing to install.`, `;color:${MUTED};font-size:13px`);

  const partnerHtml =
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;border-collapse:collapse;width:100%;background:#fff8dc;border-left:4px solid ${YELLOW}">` +
    `<tr><td style="padding:16px 18px;font-size:15px;color:${BODY};line-height:1.6">` +
    `<strong style="color:${NAVY};font-size:16px">Interested in a specific innovation?</strong><br>` +
    `If one of the teams caught your eye, whether for funding, piloting, mentoring, research or simply a conversation, we'd love to connect you. ` +
    `Write to us at ${mail} with the booth name or number, and we'll put you in touch with the team to explore partnerships and collaborations.` +
    `</td></tr></table>`;

  const orgRows = ORGANIZERS.map((o) =>
    `<tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;font-size:14px;line-height:1.5;color:${BODY}">` +
    `<strong style="color:${NAVY}">${esc(o.name)}</strong><br>${esc(o.blurb)}<br>` +
    `<a href="${esc(o.url)}" style="color:${NAVY}">${esc(o.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` +
    `</td></tr>`).join('');
  const recognitionHtml =
    h2('With gratitude') +
    p(`The Youth Innovations Marketplace was co-organized by <strong>Violence Ends With Us</strong>, <strong>Kindernothilfe</strong> and <strong>Terre des Hommes Netherlands</strong>, with support from German Cooperation and the European Union, as a satellite event of the 2nd Global Ministerial Conference on Ending Violence Against Children.`) +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;width:100%"><tr><td align="center">` +
    `<img src="${APP_URL}/brand/partners.png" alt="Organized by Violence Ends With Us, Kindernothilfe and Terre des Hommes Netherlands. Supported by German Cooperation and co-funded by the European Union." width="440" style="display:block;border:0;width:100%;max-width:440px;height:auto">` +
    `</td></tr></table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-collapse:collapse;width:100%">${orgRows}</table>`;

  const closingHtml =
    p(`Above all, thank you to the youth innovators themselves, for their courage, their creativity and their insistence that a world without violence against children is possible.`, ';margin-top:22px') +
    p(`With warm thanks,<br><strong style="color:${NAVY}">The Youth Innovations Marketplace team</strong><br>` +
      `<span style="color:${MUTED};font-size:13px">Violence Ends With Us &middot; Kindernothilfe &middot; Terre des Hommes Netherlands</span>`, ';margin-bottom:0');

  const html = layout(event,
    variant === 'attended'
      ? 'Thank you for joining us on 17 November. All 24 booths are still open online.'
      : 'Thank you for registering. All 24 youth booths are open online.',
    `<h1 style="margin:0 0 16px;color:${NAVY};font-size:22px;line-height:1.3">${esc(opening.title)}</h1>` +
    p(`Hi ${esc(first)},`) +
    opening.html.map((s) => p(esc(s))).join('') +
    marketplaceHtml + partnerHtml + recognitionHtml + closingHtml);

  const text = [
    `Hi ${first},`,
    ...opening.html,
    variant === 'attended' ? 'REVISIT THE BOOTHS, OR SEE THE ONES YOU MISSED' : 'VISIT THE MARKETPLACE ONLINE',
    `All 24 youth-led booths from the 17th are in the Digital Marketplace. Walk the hall in 3D, read each team's poster, and learn how young people are tackling online child sexual exploitation and abuse, child labour, corporal punishment, and child, early and forced marriage.`,
    `Visit the Digital Marketplace: ${DIGITAL_MARKETPLACE_URL}`,
    'INTERESTED IN A SPECIFIC INNOVATION?',
    `If one of the teams caught your eye, whether for funding, piloting, mentoring, research or simply a conversation, we'd love to connect you. Write to us at ${PARTNERSHIP_EMAIL} with the booth name or number, and we'll put you in touch with the team to explore partnerships and collaborations.`,
    'WITH GRATITUDE',
    `The Youth Innovations Marketplace was co-organized by Violence Ends With Us, Kindernothilfe and Terre des Hommes Netherlands, with support from German Cooperation and the European Union, as a satellite event of the 2nd Global Ministerial Conference on Ending Violence Against Children.`,
    ORGANIZERS.map((o) => `- ${o.name}: ${o.url}`).join('\n'),
    `Above all, thank you to the youth innovators themselves, for their courage, their creativity and their insistence that a world without violence against children is possible.`,
    `With warm thanks,\nThe Youth Innovations Marketplace team\nViolence Ends With Us · Kindernothilfe · Terre des Hommes Netherlands`,
  ].join('\n\n') + textFooter(event);

  return {
    subject: variant === 'attended'
      ? `Thank you for being part of the ${event.name}`
      : `Thank you for registering for the ${event.name}`,
    html,
    text,
  };
}

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
          qr + detailsHtml(event) + safeguardingBlockHtml() +
          `<p style="margin:16px 0 8px;color:${NAVY};font-weight:bold">What to bring</p>` +
          `<ul style="margin:0 0 12px;padding-left:20px"><li>This QR code — on your phone or printed</li><li>A valid photo ID</li></ul>` +
          (event.arrival_note ? `<p style="margin:0 0 12px">${esc(event.arrival_note)}</p>` : '') +
          `<p style="margin:0 0 12px">A calendar invite (.ics) is attached. If the QR code doesn't display, open your ticket page:</p>` +
          button(ticketLink, 'Open my ticket') +
          `<p style="margin:0;color:${MUTED};font-size:13px">This ticket is personal — please don't share it.</p>`),
        text: `Hi ${first},\n\nYour registration for ${event.name} has been approved.\n\nYour QR ticket: ${ticketLink}\n(Open the link and show the QR code at the registration desk.)\n\n${detailsText(event)}\n${safeguardingBlockText()}\nWhat to bring:\n- Your QR code (on your phone or printed)\n- A valid photo ID\n${event.arrival_note ? `\n${event.arrival_note}\n` : ''}\nA calendar invite is attached. This ticket is personal — please don't share it.` + textFooter(event),
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

    case 'safeguarding': {
      const { date } = when(event);
      return {
        subject: `Action required: Child Safeguarding and Code of Conduct - ${event.name}`,
        html: layout(event, 'Please complete the Child Safeguarding and Code of Conduct form before the event.',
          h1('Action required: Child Safeguarding and Code of Conduct') + hi +
          `<p style="margin:0 0 12px">You're confirmed for <strong>${esc(event.name)}</strong> on ${esc(date)}. ${esc(SAFEGUARDING_LINE)}</p>` +
          `<p style="margin:0 0 12px"><strong>Please complete the form before the event.</strong></p>` +
          button(SAFEGUARDING_FORM_URL, 'Complete the safeguarding form') +
          `<p style="margin:0 0 12px;color:${MUTED};font-size:13px">If the button doesn't work, copy this link into your browser:<br><a href="${esc(SAFEGUARDING_FORM_URL)}" style="color:${NAVY};word-break:break-all">${esc(SAFEGUARDING_FORM_URL)}</a></p>` +
          `<p style="margin:0">If you have already submitted this form, you don't need to do it again. Thank you!</p>`),
        text: `Hi ${first},\n\nYou're confirmed for ${event.name} on ${date}. ${SAFEGUARDING_LINE}\n\nPlease complete the form before the event:\n${SAFEGUARDING_FORM_URL}\n\nIf you have already submitted this form, you don't need to do it again. Thank you!` + textFooter(event),
      };
    }
  }
}
