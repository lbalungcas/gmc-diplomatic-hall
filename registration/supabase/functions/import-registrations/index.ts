// Bulk import of existing pre-registrations (e.g. the Google Form "Responses" CSV). The admin
// app matches CSV columns to form questions and sends each row as { answers, created_at };
// this re-derives the core fields from the form and inserts them as Pending without emailing.
import { db, requireAdmin } from '../_shared/db.ts';
import { extractCore, isEmail, questions, resolveForm, type Answers } from '../_shared/form.ts';
import { HttpError, serve } from '../_shared/http.ts';

const MAX_ROWS = 1000;

serve(async (req, body) => {
  const admin = await requireAdmin(req);

  const eventId = body.event_id;
  const rows = body.rows;
  if (typeof eventId !== 'string') throw new HttpError(400, 'Missing event id.');
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new HttpError(400, `Send between 1 and ${MAX_ROWS} rows.`);
  }
  // The original form must have collected consent; the admin confirms that on import.
  if (body.consent_confirmed !== true) {
    throw new HttpError(400, 'Confirm that these registrants agreed to the use of their data in the original form.');
  }

  const { data: event, error: eventError } = await db.from('events').select('form_schema').eq('id', eventId).maybeSingle();
  if (eventError) throw eventError;
  if (!event) throw new HttpError(404, 'Event not found.');
  const form = resolveForm(event.form_schema);
  const known = new Set(questions(form).map((q) => q.id));

  const valid: Record<string, unknown>[] = [];
  const invalid: { row: number; error: string }[] = [];
  rows.forEach((raw, i) => {
    const row = (raw ?? {}) as { answers?: Record<string, unknown>; created_at?: unknown };
    const answers: Answers = {};
    for (const [id, v] of Object.entries(row.answers ?? {})) {
      if (!known.has(id)) continue;
      if (typeof v === 'string' && v.trim()) answers[id] = v.trim().slice(0, 3000);
      else if (Array.isArray(v)) answers[id] = v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 1000));
    }
    const core = extractCore(form, answers);
    if (!core.full_name) return invalid.push({ row: i + 1, error: 'Missing name.' });
    if (!isEmail(core.email)) return invalid.push({ row: i + 1, error: 'Missing or invalid email.' });
    const createdAt = Date.parse(String(row.created_at ?? ''));
    valid.push({
      ...core,
      answers,
      privacy_consent: true,
      created_at: Number.isNaN(createdAt) ? null : new Date(createdAt).toISOString(),
      _row: i + 1,
    });
  });

  let result = { inserted: 0, duplicates: 0, errors: [] as { row: number; error: string }[] };
  if (valid.length) {
    const { data, error } = await db.rpc('import_registrations', {
      p_event: eventId,
      p_rows: valid,
      p_actor: admin.userId,
      p_actor_email: admin.email,
    });
    if (error) throw error;
    // The RPC numbers rows within `valid`; map back to the original CSV row numbers.
    result = {
      ...data,
      errors: (data.errors as { row: number; error: string }[]).map((e) => ({ ...e, row: valid[e.row - 1]._row as number })),
    };
  }

  const minorsNeedingConsent = valid.filter((r) => typeof r.age === 'number' && r.age < 18).length;
  return { ...result, minorsNeedingConsent, errors: [...invalid, ...result.errors].sort((a, b) => a.row - b.row) };
});
