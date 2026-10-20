// Runs the registration migrations against PGlite with a minimal Supabase auth/roles shim,
// then exercises RLS and the RPCs as anon / scanner / admin / service.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2];
const mig = (f) => readFileSync(join(ROOT, 'supabase', f), 'utf8');

const db = new PGlite({ extensions: { pgcrypto } });
let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const expectError = async (fn, re, label) => {
  try {
    await fn();
    ok(false, label, 'no error');
  } catch (e) {
    ok(re.test(e.message), label, e.message);
  }
};

// ── Supabase shim ──
await db.exec(`
  create schema extensions;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const f of [
  'migrations/20261020000001_registration_schema.sql',
  'migrations/20261020000002_registration_rls.sql',
  'migrations/20261020000003_registration_functions.sql',
  'seed.sql',
]) {
  await db.exec(mig(f));
  console.log(`applied ${f}`);
}
// Migrations must be re-runnable (create … if not exists / or replace).
await db.exec(mig('migrations/20261020000001_registration_schema.sql'));
await db.exec(mig('migrations/20261020000002_registration_rls.sql'));
await db.exec(mig('migrations/20261020000003_registration_functions.sql'));
console.log('re-applied migrations OK');

const [{ id: eventId }] = await q(`select id from events where slug = 'yim-2026'`);

const as = async (role, sub, fn) => {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
};

const person = (n, extra = {}) => ({
  full_name: `Person ${n}`, preferred_name: `P${n}`, email: `Person${n}@Example.org`, organization: 'Org',
  category: 'I am a social worker, youth advocate from NGO / CSO', country: 'Philippines', nationality: 'Filipino',
  age: 30, privacy_consent: true, photo_consent: n % 2 === 0,
  answers: { category: 'I am a social worker, youth advocate from NGO / CSO', attendance: ['In person, at the Marriott Hotel Manila'] },
  ...extra,
});
const register = async (p) => (await q(`select public.create_registration('yim-2026', $1::jsonb) r`, [JSON.stringify(p)]))[0].r;

// ── public registration (service role path) ──
const r1 = await register(person(1));
ok(r1.outcome === 'created' && r1.status === 'pending', 'create_registration → pending');
ok(/^[A-Za-z0-9_-]{43}$/.test(r1.ticket_token), 'ticket token is 256-bit url-safe', r1.ticket_token);
const dup = await register(person(1, { email: 'PERSON1@example.org' }));
ok(dup.outcome === 'duplicate', 'duplicate email (case-insensitive) detected');
await expectError(() => register(person(2, { age: 15 })), /minors_need_guardian/, 'under-18 without guardian rejected (online form)');
const r3 = await register(person(3, { age: 16, guardian_name: 'G', guardian_email: 'g@x.org', guardian_consent: true }));
ok(r3.outcome === 'created', 'under-18 with guardian accepted');
const r3row = (await q(`select age, age_group, answers, preferred_name, nationality from registrations where id = $1`, [r3.registration_id]))[0];
ok(r3row.age === 16 && r3row.age_group === 'under-18' && r3row.answers.attendance?.[0] === 'In person, at the Marriott Hotel Manila'
  && r3row.preferred_name === 'P3' && r3row.nationality === 'Filipino', 'age group derived; answers + new fields stored');
await expectError(() => register(person(8, { answers: [] })), /registrations_answers_check/, 'answers must be a JSON object');
await expectError(() => register(person(4, { privacy_consent: false })), /form_fields_required/, 'missing privacy consent rejected');
const r5 = await register(person(5));
const r6 = await register(person(6));

// ── anon ──
await as('anon', null, async () => {
  await expectError(() => q('select * from registrations'), /permission denied/, 'anon cannot select registrations');
  await expectError(() => q('select * from audit_log'), /permission denied/, 'anon cannot select audit_log');
  await expectError(() => q('select * from admin_users'), /permission denied/, 'anon cannot select admin_users');
  ok((await q('select * from events')).length === 1, 'anon can read events');
  await expectError(() => q(`update events set capacity = 1`), /permission denied/, 'anon cannot update events');
  await expectError(() => q(`select public.save_form_schema($1, '{"version":1,"sections":[{}]}')`, [eventId]), /permission denied/, 'anon cannot save the form');
  await expectError(() => q(`select public.create_registration('yim-2026', '{}'::jsonb)`), /permission denied/, 'anon cannot call create_registration');
  await expectError(() => q(`select public.check_in($1)`, [r1.ticket_token]), /permission denied/, 'anon cannot call check_in');
  const t = (await q(`select public.get_ticket($1) t`, [r1.ticket_token]))[0].t;
  ok(t?.full_name === 'Person 1' && t.status === 'pending' && !('email' in t) && !('ticket_token' in t), 'anon get_ticket returns own minimal data');
  ok((await q(`select public.get_ticket('nope') t`))[0].t === null, 'get_ticket with bad token → null');
  const av = (await q(`select public.event_availability('yim-2026') a`))[0].a;
  ok(av.registration_open === true && av.is_full === false, 'event_availability', JSON.stringify(av));
});

// ── staff accounts ──
const [{ id: adminId }] = await q(`insert into auth.users (email) values ('admin@x.org') returning id`);
const [{ id: scannerId }] = await q(`insert into auth.users (email) values ('door@x.org') returning id`);
const [{ id: randoId }] = await q(`insert into auth.users (email) values ('rando@x.org') returning id`);
await q(`select public.add_staff('ADMIN@x.org', 'admin')`);
await q(`select public.add_staff('door@x.org', 'scanner')`);

await as('authenticated', randoId, async () => {
  ok((await q('select * from registrations')).length === 0, 'signed-in non-staff sees no registrations');
  await expectError(() => q(`select public.check_in($1)`, [r1.ticket_token]), /not authorized/, 'non-staff cannot check in');
  await expectError(() => q(`select public.event_stats($1)`, [eventId]), /not authorized/, 'non-staff cannot read stats');
});

await as('authenticated', scannerId, async () => {
  ok((await q('select * from registrations')).length === 0, 'scanner sees no registration rows (no emails/phones)');
  ok((await q('select * from audit_log')).length === 0, 'scanner cannot read audit_log');
  await expectError(() => q(`select public.decide_registrations(array[$1::uuid], 'approved', null, false, $2, 'x')`, [r1.registration_id, scannerId]),
    /permission denied/, 'scanner cannot approve (decide_registrations)');
  await expectError(() => q(`update registrations set status = 'approved'`), /permission denied/, 'scanner cannot update registrations directly');
  await expectError(() => q(`select public.log_export($1, 1, '{}')`, [eventId]), /not authorized/, 'scanner cannot log/perform export');
  await expectError(() => q(`select public.save_form_schema($1, '{"version":1,"sections":[{}]}')`, [eventId]), /not authorized/, 'scanner cannot edit the form');
  await expectError(() => q(`select public.record_guardian_consent($1, 'G', 'g@x.org')`, [r1.registration_id]), /not authorized/, 'scanner cannot record guardian consent');
  const res = (await q(`select public.check_in($1) r`, [r1.ticket_token]))[0].r;
  ok(res.result === 'not_approved' && res.status === 'pending', 'scanning a pending ticket → not_approved');
  const inv = (await q(`select public.check_in($1) r`, ['x'.repeat(43)]))[0].r;
  ok(inv.result === 'invalid', 'unknown token → invalid');
  const hits = await q(`select * from public.search_checkin($1, 'person')`, [eventId]);
  ok(hits.length === 4 && !('email' in hits[0]), 'search_checkin finds people without exposing email');
  ok((await q(`select * from public.search_checkin($1, '%')`, [eventId])).length === 0, 'search_checkin escapes LIKE wildcards');
});

await as('authenticated', adminId, async () => {
  ok((await q('select * from registrations')).length === 4, 'admin can read registrations');
  ok((await q('select * from admin_users')).length === 2, 'admin can read admin_users');
  await q(`update events set capacity = 2 where id = $1`, [eventId]);
  ok((await q('select capacity from events'))[0].capacity === 2, 'admin can update event settings');
  await expectError(() => q(`update events set form_schema = '{}' where id = $1`, [eventId]), /permission denied/, 'admin cannot bypass the audited form save');
  const schema = { version: 1, sections: [{ id: 's1', blocks: [] }] };
  await q(`select public.save_form_schema($1, $2::jsonb)`, [eventId, JSON.stringify(schema)]);
  ok((await q('select form_schema from events'))[0].form_schema.sections[0].id === 's1', 'admin saves the form via save_form_schema');
  await expectError(() => q(`select public.save_form_schema($1, '{"version":2,"sections":[]}')`, [eventId]), /invalid form schema/, 'malformed form rejected');
  await q(`select public.save_form_schema($1, null)`, [eventId]);
  ok((await q('select form_schema from events'))[0].form_schema === null, 'reset to the built-in form');
  const edits = await q(`select action, actor_email, after from audit_log where action in ('edit_form','reset_form') order by id`);
  ok(edits.length === 2 && edits[0].actor_email === 'admin@x.org' && edits[0].after.sections[0].id === 's1' && edits[1].action === 'reset_form',
    'form edits are versioned in the audit log');
});

// ── decisions (service role, as the decide Edge Function does) ──
const decide = async (ids, d, force = false, reason = null) =>
  (await q(`select public.decide_registrations($1::uuid[], $2, $3, $4, $5, 'admin@x.org') r`, [ids, d, reason, force, adminId]))[0].r;
let out = await decide([r1.registration_id, r3.registration_id, r5.registration_id], 'approved');
ok(out.filter((o) => o.outcome === 'updated').length === 2 && out.find((o) => o.id === r5.registration_id).outcome === 'over_capacity',
  'approve respects capacity (2) — third is over_capacity', JSON.stringify(out.map((o) => o.outcome)));
out = await decide([r5.registration_id], 'approved', true);
ok(out[0].outcome === 'updated', 'force approve overrides capacity');
out = await decide([r1.registration_id], 'approved');
ok(out[0].outcome === 'unchanged', 're-approving is a no-op');
out = await decide([r6.registration_id], 'declined', false, '  Capacity for this group reached ');
ok(out[0].outcome === 'updated', 'decline');
ok((await q(`select decline_reason from registrations where id = $1`, [r6.registration_id]))[0].decline_reason === 'Capacity for this group reached', 'decline reason trimmed and stored');

// Event is now over capacity → new sign-ups auto-waitlisted.
const r7 = await register(person(7));
ok(r7.status === 'waitlisted', 'auto-waitlist when full');

// ── check-in ──
await as('authenticated', scannerId, async () => {
  const a = (await q(`select public.check_in($1) r`, [r1.ticket_token]))[0].r;
  ok(a.result === 'checked_in' && a.full_name === 'Person 1' && a.photo_consent === false, 'approved ticket → checked_in (with photo consent)');
  const b = (await q(`select public.check_in($1) r`, [r1.ticket_token]))[0].r;
  ok(b.result === 'already_checked_in' && b.checked_in_at === a.checked_in_at, 'second scan → already_checked_in with first time');
  const c = (await q(`select public.check_in($1) r`, [r6.ticket_token]))[0].r;
  ok(c.result === 'not_approved' && c.status === 'declined', 'declined ticket → not_approved (declined)');
  const d = (await q(`select public.check_in_manual($1) r`, [r3.registration_id]))[0].r;
  ok(d.result === 'checked_in', 'manual check-in');
  const u = (await q(`select public.undo_check_in($1) r`, [r3.registration_id]))[0].r;
  ok(u.ok === true, 'undo check-in');
  const u2 = (await q(`select public.undo_check_in($1) r`, [r3.registration_id]))[0].r;
  ok(u2.ok === false, 'undo when not checked in → ok:false');
  const s = (await q(`select public.event_stats($1) s`, [eventId]))[0].s;
  ok(s.approved === 3 && s.checked_in === 1 && s.declined === 1 && s.waitlisted === 1 && s.pending === 0 && s.remaining === 0,
    'event_stats counts', JSON.stringify({ ...s, by_category: undefined }));
});

out = await decide([r1.registration_id], 'declined');
ok(out[0].outcome === 'checked_in', 'cannot decline someone already checked in');

const audit = await q(`select action, actor_email, meta from audit_log where registration_id = $1 order by id`, [r1.registration_id]);
ok(JSON.stringify(audit.map((a) => a.action)) === JSON.stringify(['register', 'approve', 'check_in']), 'audit trail for registrant', audit.map((a) => a.action).join(','));
ok(audit[2].actor_email === 'door@x.org' && audit[2].meta.method === 'scan', 'check-in audit records scanner + method');
const undoAudit = await q(`select 1 from audit_log where action = 'undo_check_in'`);
ok(undoAudit.length === 1, 'undo check-in is audited');

// ── import ──
const imp = (await q(`select public.import_registrations($1, $2::jsonb, $3, 'admin@x.org') r`, [eventId, JSON.stringify([
  { full_name: 'Imported A', email: 'imp-a@x.org', category: 'I am a parent / teacher', age: 40, privacy_consent: true, created_at: '2026-09-01T10:00:00Z', answers: { sex: 'Female' } },
  { full_name: 'Dup', email: 'person1@example.org', privacy_consent: true },
  { full_name: 'Bad age', email: 'bad@x.org', age: 500, privacy_consent: true },
  { full_name: 'Minor', email: 'minor@x.org', age: 14, privacy_consent: true },
]), adminId]))[0].r;
ok(imp.inserted === 2 && imp.duplicates === 1 && imp.errors.length === 1, 'import: inserted/duplicates/errors', JSON.stringify(imp));
ok((await q(`select status, answers from registrations where email = 'imp-a@x.org'`))[0].answers.sex === 'Female', 'imported rows keep answers, pending');
const [minor] = await q(`select id, age_group, guardian_consent from registrations where email = 'minor@x.org'`);
ok(minor.age_group === 'under-18' && minor.guardian_consent === false, 'imported under-18 is let in without guardian (flagged)');
await q(`update events set capacity = 100 where id = $1`, [eventId]);
out = await decide([minor.id], 'approved');
ok(out[0].outcome === 'needs_guardian', 'under-18 without guardian consent cannot be approved');
out = await decide([minor.id], 'approved', true);
ok(out[0].outcome === 'needs_guardian', '…not even with the capacity override');
await as('authenticated', adminId, async () => {
  await expectError(() => q(`select public.record_guardian_consent($1, 'Parent', 'not-an-email')`, [minor.id]), /valid email/, 'guardian consent needs a valid email');
  await q(`select public.record_guardian_consent($1, 'Parent', 'Parent@X.org')`, [minor.id]);
});
out = await decide([minor.id], 'approved');
ok(out[0].outcome === 'updated', 'approved once guardian consent is recorded');
ok((await q(`select 1 from audit_log where action = 'guardian_consent' and registration_id = $1`, [minor.id])).length === 1, 'guardian consent is audited');

// ── rate limit ──
let allowed = 0;
for (let i = 0; i < 7; i++) if ((await q(`select public.hit_rate_limit('t', 5, 600) a`))[0].a) allowed++;
ok(allowed === 5, 'rate limit allows 5 of 7');

// ── anonymize ──
const n = (await q(`select public.anonymize_event_registrations($1) n`, [eventId]))[0].n;
const leftovers = await q(`select * from registrations where full_name <> 'Anonymized' or email not like 'anon-%' or guardian_email is not null
  or preferred_name is not null or nationality is not null or age is not null or answers <> '{}'::jsonb`);
ok(n === 7 && leftovers.length === 0, 'anonymize strips personal data incl. form answers', `n=${n}`);
ok((await q(`select public.get_ticket($1) t`, [r1.ticket_token]))[0].t === null, 'old ticket links stop working after anonymizing');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
