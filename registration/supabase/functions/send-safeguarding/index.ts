// Email confirmed registrants the Child Safeguarding and Code of Conduct form.
// Anyone already sent it successfully is skipped unless `force` is set, so the bulk button can
// be pressed again to retry failures. The client sends at most MAX_IDS per call.
import { db, loadEvent, loadRegistrations, requireAdmin } from '../_shared/db.ts';
import { HttpError, serve } from '../_shared/http.ts';
import { sendStatusEmail } from '../_shared/notify.ts';

const MAX_IDS = 50;

type Outcome = 'sent' | 'failed' | 'skipped' | 'already_sent' | 'not_confirmed' | 'not_found';

serve(async (req, body) => {
  const admin = await requireAdmin(req);

  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
    throw new HttpError(400, `Send between 1 and ${MAX_IDS} registration ids.`);
  }
  const force = body.force === true;

  const regs = await loadRegistrations(ids as string[]);
  const byId = new Map(regs.map((r) => [r.id, r]));

  const { data: sentRows, error: sentError } = await db
    .from('email_log')
    .select('registration_id')
    .in('registration_id', ids as string[])
    .eq('template', 'safeguarding')
    .eq('status', 'sent');
  if (sentError) throw sentError;
  const alreadySent = new Set((sentRows ?? []).map((r) => r.registration_id as string));

  const outcomes: { id: string; outcome: Outcome }[] = [];
  const event = regs.length ? await loadEvent(regs[0].event_id) : null;

  for (const id of ids as string[]) {
    const reg = byId.get(id);
    if (!reg || reg.anonymized_at || !event) {
      outcomes.push({ id, outcome: 'not_found' });
      continue;
    }
    if (reg.status !== 'approved') {
      outcomes.push({ id, outcome: 'not_confirmed' });
      continue;
    }
    if (!force && alreadySent.has(id)) {
      outcomes.push({ id, outcome: 'already_sent' });
      continue;
    }

    const result = await sendStatusEmail(reg, event, 'safeguarding');
    if (!result.logged) {
      // Without the log the next press would email this person again; stop before sending more.
      throw new HttpError(500, 'Could not record the email in email_log. Has the safeguarding migration been applied? Stopped sending.', { outcomes });
    }
    outcomes.push({ id, outcome: result.status });

    if (result.status !== 'failed') {
      await db.from('audit_log').insert({
        actor: admin.userId,
        actor_email: admin.email,
        action: 'safeguarding_email',
        event_id: reg.event_id,
        registration_id: reg.id,
        meta: { result: result.status, force },
      });
    }
  }

  return { outcomes };
});
