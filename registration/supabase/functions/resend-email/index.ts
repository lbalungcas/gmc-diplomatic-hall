// Re-send the email matching a registration's current status (pending → pending email,
// approved → QR ticket, …).
import { db, loadEvent, loadRegistrations, requireAdmin } from '../_shared/db.ts';
import { HttpError, serve } from '../_shared/http.ts';
import { sendStatusEmail, templateForStatus } from '../_shared/notify.ts';

serve(async (req, body) => {
  const admin = await requireAdmin(req);
  if (typeof body.id !== 'string') throw new HttpError(400, 'Missing registration id.');

  const [reg] = await loadRegistrations([body.id]);
  if (!reg || reg.anonymized_at) throw new HttpError(404, 'Registration not found.');
  const template = templateForStatus(reg.status);
  if (!template) throw new HttpError(409, `There is no email for status "${reg.status}".`);

  const event = await loadEvent(reg.event_id);
  const result = await sendStatusEmail(reg, event, template, true);

  await db.from('audit_log').insert({
    actor: admin.userId,
    actor_email: admin.email,
    action: 'resend_email',
    event_id: reg.event_id,
    registration_id: reg.id,
    meta: { template, result: result.status },
  });

  if (result.status === 'failed') throw new HttpError(502, `Email failed: ${result.error}`);
  return { template, status: result.status };
});
