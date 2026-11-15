// After a guest checks out, email them their People's Choice ballot, once. Called by the guest's own
// phone with their ticket token (self check-out), or by staff with the registration id (scanner and
// manual check-out). Only checked-out, approved registrants are emailed, and only while People's
// Choice voting is open. A guest gets the ballot back in the response so they can vote right away.
import { ballotUrl } from '../_shared/constants.ts';
import { db, loadEvent, requireStaff } from '../_shared/db.ts';
import { emailProvider, type SendResult } from '../_shared/email.ts';
import { clientIp, HttpError, serve } from '../_shared/http.ts';
import { renderBallotEmail } from '../_shared/templates.ts';

type Outcome = 'sent' | 'skipped' | 'failed' | 'already_sent' | 'already_voted' | 'not_open' | 'not_checked_out';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

interface RegRow {
  id: string;
  event_id: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  status: string;
  checked_out_at: string | null;
  anonymized_at: string | null;
}

serve(async (req, body) => {
  const token = typeof body.token === 'string' ? body.token : null;
  const registrationId = typeof body.registration_id === 'string' ? body.registration_id : null;
  const isGuest = token !== null;

  let reg: RegRow | null;
  const columns = 'id, event_id, email, full_name, preferred_name, status, checked_out_at, anonymized_at';
  if (isGuest) {
    if (!TOKEN_RE.test(token)) throw new HttpError(400, 'Invalid ticket.');
    const { data: ok, error: rlError } = await db.rpc('hit_rate_limit', { p_key: `checkout-ballot:${clientIp(req)}`, p_max: 30, p_window_seconds: 600 });
    if (rlError) throw rlError;
    if (ok !== true) throw new HttpError(429, 'Too many requests. Please try again in a few minutes.');
    const { data, error } = await db.from('registrations').select(columns).eq('ticket_token', token).maybeSingle();
    if (error) throw error;
    reg = data as RegRow | null;
  } else if (registrationId) {
    await requireStaff(req);
    const { data, error } = await db.from('registrations').select(columns).eq('id', registrationId).maybeSingle();
    if (error) throw error;
    reg = data as RegRow | null;
  } else {
    throw new HttpError(400, 'Missing token or registration_id.');
  }
  if (!reg || reg.anonymized_at) throw new HttpError(404, 'Ticket not found.');
  if (!reg.checked_out_at || reg.status !== 'approved') return { outcome: 'not_checked_out' satisfies Outcome };

  const { data: award, error: awardError } = await db
    .from('awards')
    .select('id, is_open, opens_at, closes_at')
    .eq('event_id', reg.event_id)
    .eq('kind', 'peoples_choice')
    .maybeSingle();
  if (awardError) throw awardError;
  const now = Date.now();
  const open = !!award?.is_open &&
    (!award.opens_at || new Date(award.opens_at).getTime() <= now) &&
    (!award.closes_at || new Date(award.closes_at).getTime() > now);
  if (!award || !open) return { outcome: 'not_open' satisfies Outcome };

  // Approved registrants are People's Choice voters; add them if "Sync approved registrants" hasn't yet.
  const email = reg.email.toLowerCase();
  const { error: upsertError } = await db.from('award_voters').upsert(
    { award_id: award.id, email, name: reg.preferred_name || reg.full_name, registration_id: reg.id },
    { onConflict: 'award_id,email', ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;
  const { data: voter, error: voterError } = await db
    .from('award_voters')
    .select('id, name, ballot_token, voted_at')
    .eq('award_id', award.id)
    .eq('email', email)
    .single();
  if (voterError) throw voterError;

  const ballot = isGuest ? { ballot_url: ballotUrl(voter.ballot_token), ballot_token: voter.ballot_token } : {};
  if (voter.voted_at) return { outcome: 'already_voted' satisfies Outcome };

  const { data: earlier, error: earlierError } = await db
    .from('email_log')
    .select('id')
    .eq('award_voter_id', voter.id)
    .eq('type', 'ballot_checkout')
    .neq('status', 'failed')
    .limit(1);
  if (earlierError) throw earlierError;
  if (earlier.length > 0) return { outcome: 'already_sent' satisfies Outcome, ...ballot };

  const event = await loadEvent(reg.event_id);
  const link = ballotUrl(voter.ballot_token);
  let result: SendResult;
  try {
    const rendered = renderBallotEmail('peoples_choice', voter.name, event, link, 'checkout');
    result = await emailProvider.send({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: event.contact_email });
  } catch (err) {
    result = { status: 'failed', error: String(err).slice(0, 500) };
  }

  const { error: logError } = await db.from('email_log').insert({
    award_voter_id: voter.id,
    type: 'ballot_checkout',
    template: 'ballot_peoples_choice',
    to_email: email,
    provider_message_id: result.messageId ?? null,
    status: result.status,
    error: result.error ?? null,
  });
  if (logError) throw new HttpError(500, 'Could not record the email in email_log.');
  if (result.status !== 'failed') {
    await db.from('award_voters').update({ sent_at: new Date().toISOString() }).eq('id', voter.id).is('sent_at', null);
  }

  return { outcome: result.status satisfies Outcome, ...ballot };
});
