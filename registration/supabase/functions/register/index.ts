// Public registration endpoint. The only way the public can write registration data.
// Validates the answers against the event's current form (the same code the browser runs).
import { EVENT_SLUG } from '../_shared/constants.ts';
import { db, loadEvent, loadRegistrations } from '../_shared/db.ts';
import { resolveForm, validateSubmission } from '../_shared/form.ts';
import { clientIp, HttpError, serve } from '../_shared/http.ts';
import { sendStatusEmail, templateForStatus } from '../_shared/notify.ts';
import { validateSystemFields } from '../_shared/validate.ts';

const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET_KEY');
const ALLOW_NO_TURNSTILE = Deno.env.get('ALLOW_NO_TURNSTILE') === 'true';

async function verifyTurnstile(token: unknown, ip: string) {
  if (!TURNSTILE_SECRET) {
    if (ALLOW_NO_TURNSTILE) return;
    throw new HttpError(500, 'Bot protection is not configured.');
  }
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'Please complete the "I am human" check.');
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const outcome = await res.json();
  if (!outcome.success) throw new HttpError(400, 'The "I am human" check expired or failed. Please try again.');
}

async function allow(key: string, max: number, windowSeconds: number) {
  const { data, error } = await db.rpc('hit_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) throw error;
  return data === true;
}

serve(async (req, body) => {
  const ip = clientIp(req);

  // Honeypot: real users never see this field. Pretend success so bots don't adapt.
  if (typeof body.website === 'string' && body.website.trim()) return { status: 'created', registrationStatus: 'pending' };

  if (!(await allow(`register:ip:${ip}`, 20, 600))) {
    throw new HttpError(429, 'Too many attempts from your network. Please wait a few minutes and try again.');
  }

  const { data: eventRow, error: eventError } = await db.from('events').select('form_schema').eq('slug', EVENT_SLUG).maybeSingle();
  if (eventError) throw eventError;
  if (!eventRow) throw new HttpError(404, 'This event was not found.');
  const form = resolveForm(eventRow.form_schema);

  const submission = validateSubmission(form, body.answers);
  const system = validateSystemFields(body, submission.core.age, submission.core.email, true);
  const errors = { ...submission.errors, ...system.errors };
  if (Object.keys(errors).length) throw new HttpError(422, 'Please check the highlighted questions.', errors);

  await verifyTurnstile(body.turnstileToken, ip);

  const { core } = submission;
  if (!(await allow(`register:email:${core.email}`, 5, 3600))) {
    throw new HttpError(429, 'Too many attempts for this email address. Please try again later.');
  }

  const { data: result, error } = await db.rpc('create_registration', {
    p_event_slug: EVENT_SLUG,
    p: { ...core, ...system.value, answers: submission.answers },
  });
  if (error) throw error;

  if (result.outcome === 'not_found') throw new HttpError(404, 'This event was not found.');
  if (result.outcome === 'closed') throw new HttpError(409, 'Registration for this event is closed.');

  const [reg] = await loadRegistrations([result.registration_id]);
  const event = await loadEvent(reg.event_id);

  if (result.outcome === 'duplicate') {
    // Re-send whichever email matches their status. Never return the token here: anyone could
    // type someone else's email address, so the link only ever goes to the inbox.
    const template = templateForStatus(reg.status);
    if (template) await sendStatusEmail(reg, event, template, true);
    return { status: 'duplicate' };
  }

  const template = reg.status === 'waitlisted' ? 'waitlisted' : 'pending';
  await sendStatusEmail(reg, event, template);
  return { status: 'created', registrationStatus: reg.status, token: reg.ticket_token };
});
