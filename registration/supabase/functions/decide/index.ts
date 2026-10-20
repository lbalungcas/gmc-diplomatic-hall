// Approve / decline / waitlist one or more registrations, then email each person.
// The client sends at most MAX_IDS per call (bulk actions are chunked) so a call stays well
// inside the Edge Function time limit while emails are paced for Resend's rate limit.
import { db, loadEvent, loadRegistrations, requireAdmin } from '../_shared/db.ts';
import { HttpError, serve } from '../_shared/http.ts';
import { sendStatusEmail } from '../_shared/notify.ts';
import type { TemplateName } from '../_shared/templates.ts';

const MAX_IDS = 50;
const DECISIONS = ['approved', 'declined', 'waitlisted', 'pending'] as const;
type Decision = (typeof DECISIONS)[number];

serve(async (req, body) => {
  const admin = await requireAdmin(req);

  const ids = body.ids;
  const decision = body.decision as Decision;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
    throw new HttpError(400, `Send between 1 and ${MAX_IDS} registration ids.`);
  }
  if (!DECISIONS.includes(decision)) throw new HttpError(400, 'Unknown decision.');
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
  const notify = body.notify !== false;

  const { data: outcomes, error } = await db.rpc('decide_registrations', {
    p_ids: ids,
    p_decision: decision,
    p_reason: reason,
    p_force: body.force === true,
    p_actor: admin.userId,
    p_actor_email: admin.email,
  });
  if (error) throw error;

  const updatedIds = (outcomes as { id: string; outcome: string }[])
    .filter((o) => o.outcome === 'updated')
    .map((o) => o.id);

  const emails: Record<string, string> = {};
  // "Move back to pending" is an admin correction, not something to email people about.
  if (notify && decision !== 'pending' && updatedIds.length) {
    const regs = await loadRegistrations(updatedIds);
    const event = await loadEvent(regs[0].event_id);
    for (const reg of regs) {
      const result = await sendStatusEmail(reg, event, decision as TemplateName);
      emails[reg.id] = result.status;
    }
  }

  return { outcomes, emails };
});
