// Email award voters their personal ballot link. The client sends at most MAX_IDS voter ids per
// call (bulk sends are chunked). Voters who already voted are never emailed. Without `reminder`,
// voters already sent a ballot are skipped unless `force` is set, so "Send ballots" can be pressed
// again to retry failures.
import { ballotUrl } from '../_shared/constants.ts';
import { db, loadEvent, requireAdmin } from '../_shared/db.ts';
import { emailProvider, type SendResult } from '../_shared/email.ts';
import { HttpError, serve } from '../_shared/http.ts';
import { type AwardKind, renderBallotEmail } from '../_shared/templates.ts';

const MAX_IDS = 50;

type Outcome = 'sent' | 'failed' | 'skipped' | 'already_sent' | 'already_voted' | 'not_found';

interface VoterRow {
  id: string;
  award_id: string;
  email: string;
  name: string | null;
  ballot_token: string;
  sent_at: string | null;
  voted_at: string | null;
}

serve(async (req, body) => {
  const admin = await requireAdmin(req);

  const awardId = body.award_id;
  const ids = body.ids;
  if (typeof awardId !== 'string') throw new HttpError(400, 'Missing award_id.');
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
    throw new HttpError(400, `Send between 1 and ${MAX_IDS} voter ids.`);
  }
  const reminder = body.reminder === true;
  const force = body.force === true;

  const { data: award, error: awardError } = await db.from('awards').select('id, event_id, kind').eq('id', awardId).maybeSingle();
  if (awardError) throw awardError;
  if (!award) throw new HttpError(404, 'Award not found.');
  const kind = award.kind as AwardKind;
  const event = await loadEvent(award.event_id);

  const { data: voters, error } = await db
    .from('award_voters')
    .select('id, award_id, email, name, ballot_token, sent_at, voted_at')
    .eq('award_id', awardId)
    .in('id', ids as string[]);
  if (error) throw error;
  const byId = new Map((voters as VoterRow[]).map((v) => [v.id, v]));

  const outcomes: { id: string; outcome: Outcome }[] = [];
  for (const id of ids as string[]) {
    const voter = byId.get(id);
    if (!voter || voter.email.startsWith('anon-')) {
      outcomes.push({ id, outcome: 'not_found' });
      continue;
    }
    if (voter.voted_at) {
      outcomes.push({ id, outcome: 'already_voted' });
      continue;
    }
    if (!reminder && !force && voter.sent_at) {
      outcomes.push({ id, outcome: 'already_sent' });
      continue;
    }

    const link = ballotUrl(voter.ballot_token);
    let result: SendResult;
    try {
      const email = renderBallotEmail(kind, voter.name, event, link, reminder ? 'reminder' : 'invite');
      result = await emailProvider.send({ to: voter.email, subject: email.subject, html: email.html, text: email.text, replyTo: event.contact_email });
    } catch (err) {
      result = { status: 'failed', error: String(err).slice(0, 500) };
    }

    const { error: logError } = await db.from('email_log').insert({
      award_voter_id: voter.id,
      type: reminder ? 'ballot_reminder' : 'ballot',
      template: kind === 'mpyi' ? 'ballot_mpyi' : 'ballot_peoples_choice',
      to_email: voter.email,
      provider_message_id: result.messageId ?? null,
      status: result.status,
      error: result.error ?? null,
    });
    if (logError) {
      // Without the log the next press would email this person again; stop before sending more.
      throw new HttpError(500, 'Could not record the email in email_log. Has the awards migration been applied? Stopped sending.', { outcomes });
    }
    if (result.status !== 'failed') {
      await db.from('award_voters').update({ sent_at: new Date().toISOString() }).eq('id', voter.id);
    }
    outcomes.push({ id, outcome: result.status });
  }

  const counts = outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.outcome]: (acc[o.outcome] ?? 0) + 1 }), {});
  await db.from('audit_log').insert({
    actor: admin.userId,
    actor_email: admin.email,
    action: reminder ? 'award_ballot_reminder' : 'award_ballot_send',
    event_id: award.event_id,
    meta: { award: kind, counts, force },
  });

  return { outcomes };
});
