// The post-event thank-you email. Three modes, all admin-only:
//
//   { event_id, preview: 'attended' | 'registered' }  → { subject, html }; renders, sends nothing
//   { event_id, test: true, variant }                 → sends one copy to the signed-in admin
//   { ids: [...], force? }                            → sends to those registrants
//
// Registrants who checked in at the door get the "attended" version, everyone else the
// "registered" one. Declined and cancelled registrations are skipped. Each email address gets the
// thank-you once: anyone it was already sent to (from this or an earlier press, or a second
// registration under the same address) is skipped unless `force` is set, so the button can be
// pressed again to retry failures. The client sends at most MAX_IDS per call.
import { db, loadEvent, loadRegistrations, requireAdmin } from '../_shared/db.ts';
import { emailProvider, type SendResult } from '../_shared/email.ts';
import { HttpError, serve } from '../_shared/http.ts';
import { renderThankYouEmail, type ThankYouVariant } from '../_shared/templates.ts';

const MAX_IDS = 50;
const ELIGIBLE = new Set(['approved', 'pending', 'waitlisted']);

type Outcome = 'sent' | 'failed' | 'skipped' | 'already_sent' | 'not_eligible' | 'not_found';

const isVariant = (v: unknown): v is ThankYouVariant => v === 'attended' || v === 'registered';

serve(async (req, body) => {
  const admin = await requireAdmin(req);

  // ── Preview and test send ──
  if (body.preview !== undefined || body.test === true) {
    if (typeof body.event_id !== 'string') throw new HttpError(400, 'Missing event_id.');
    const event = await loadEvent(body.event_id);
    const variant = body.preview ?? body.variant;
    if (!isVariant(variant)) throw new HttpError(400, "variant must be 'attended' or 'registered'.");

    if (body.preview !== undefined) {
      const email = renderThankYouEmail('Alex', event, variant);
      return { subject: email.subject, html: email.html };
    }

    const email = renderThankYouEmail(null, event, variant);
    let result: SendResult;
    try {
      result = await emailProvider.send({
        to: admin.email,
        subject: `[Test] ${email.subject}`,
        html: email.html,
        text: email.text,
        replyTo: event.contact_email,
      });
    } catch (err) {
      result = { status: 'failed', error: String(err).slice(0, 500) };
    }
    return { outcome: result.status, to: admin.email, error: result.error ?? null };
  }

  // ── Send to registrants ──
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
    throw new HttpError(400, `Send between 1 and ${MAX_IDS} registration ids.`);
  }
  const force = body.force === true;

  const regs = await loadRegistrations(ids as string[]);
  const byId = new Map(regs.map((r) => [r.id, r]));
  const event = regs.length ? await loadEvent(regs[0].event_id) : null;

  // Addresses that already have it, from any registration.
  const addresses = [...new Set(regs.map((r) => r.email.toLowerCase()))];
  const alreadySent = new Set<string>();
  if (addresses.length) {
    const { data: sentRows, error: sentError } = await db
      .from('email_log')
      .select('to_email')
      .eq('template', 'thank_you')
      .eq('status', 'sent')
      .in('to_email', [...addresses, ...regs.map((r) => r.email)]);
    if (sentError) throw sentError;
    for (const r of sentRows ?? []) alreadySent.add(String(r.to_email).toLowerCase());
  }

  const outcomes: { id: string; outcome: Outcome }[] = [];
  const counts: Record<string, number> = {};
  const done = (id: string, outcome: Outcome) => {
    outcomes.push({ id, outcome });
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  };

  for (const id of ids as string[]) {
    const reg = byId.get(id);
    if (!reg || reg.anonymized_at || !event) {
      done(id, 'not_found');
      continue;
    }
    if (!ELIGIBLE.has(reg.status)) {
      done(id, 'not_eligible');
      continue;
    }
    const address = reg.email.toLowerCase();
    if (!force && alreadySent.has(address)) {
      done(id, 'already_sent');
      continue;
    }

    const variant: ThankYouVariant = reg.checked_in_at ? 'attended' : 'registered';
    let result: SendResult;
    try {
      const email = renderThankYouEmail(reg.preferred_name || reg.full_name, event, variant);
      result = await emailProvider.send({ to: reg.email, subject: email.subject, html: email.html, text: email.text, replyTo: event.contact_email });
    } catch (err) {
      result = { status: 'failed', error: String(err).slice(0, 500) };
    }

    const { error: logError } = await db.from('email_log').insert({
      registration_id: reg.id,
      type: 'thank_you',
      template: 'thank_you',
      to_email: reg.email,
      provider_message_id: result.messageId ?? null,
      status: result.status,
      error: result.error ?? null,
    });
    if (logError) {
      // Without the log the next press would email this person again; stop before sending more.
      throw new HttpError(500, 'Could not record the email in email_log. Has the thank-you migration been applied? Stopped sending.', { outcomes });
    }
    // A second registration under the same address in this batch is not emailed again.
    if (result.status === 'sent') alreadySent.add(address);
    done(id, result.status);

    if (result.status !== 'failed') {
      await db.from('audit_log').insert({
        actor: admin.userId,
        actor_email: admin.email,
        action: 'thank_you_email',
        event_id: reg.event_id,
        registration_id: reg.id,
        meta: { result: result.status, variant, force },
      });
    }
  }

  return { outcomes, counts };
});
