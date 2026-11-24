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
  'migrations/20261111000001_safeguarding_email.sql',
  'migrations/20261112000001_no_capacity_and_reg_kit.sql',
  'migrations/20261115000002_checkout.sql',
  'migrations/20261115000003_awards.sql',
  'migrations/20261115000004_mpyi_details.sql',
  'migrations/20261116000001_pc_quick_vote.sql',
  'migrations/20261116000002_staff_checkout_ballot.sql',
  'migrations/20261124000001_thank_you_email.sql',
  'seed.sql',
]) {
  await db.exec(mig(f));
  console.log(`applied ${f}`);
}
// Migrations must be re-runnable (create … if not exists / or replace). Re-applying the original
// functions file reverts the functions the newer migration replaced, so that one is re-applied last.
await db.exec(mig('migrations/20261020000001_registration_schema.sql'));
await db.exec(mig('migrations/20261020000002_registration_rls.sql'));
// search_checkin's return type grew a column later; "create or replace" can't shrink it back.
await db.exec('drop function public.search_checkin(uuid, text)');
await db.exec(mig('migrations/20261020000003_registration_functions.sql'));
await db.exec(mig('migrations/20261111000001_safeguarding_email.sql'));
await db.exec(mig('migrations/20261112000001_no_capacity_and_reg_kit.sql'));
await db.exec(mig('migrations/20261115000002_checkout.sql'));
await db.exec(mig('migrations/20261115000003_awards.sql'));
await db.exec(mig('migrations/20261115000004_mpyi_details.sql'));
await db.exec(mig('migrations/20261116000001_pc_quick_vote.sql'));
await db.exec(mig('migrations/20261116000002_staff_checkout_ballot.sql'));
await db.exec(mig('migrations/20261124000001_thank_you_email.sql'));
await db.exec(mig('seed.sql'));
console.log('re-applied migrations OK');

const [{ id: eventId }] = await q(`select id from events where slug = 'yim-2026'`);
const seeded = (await q(`select capacity, auto_waitlist, registration_closes_at from events`))[0];
ok(seeded.capacity === null && seeded.auto_waitlist === false && new Date(seeded.registration_closes_at).toISOString() === '2026-11-17T09:00:00.000Z',
  'seed: no capacity limit, no auto-waitlist, open through the event day', JSON.stringify(seeded));

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
  await q(`update events set capacity = 2, auto_waitlist = true where id = $1`, [eventId]);
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

// ── reg kit ──
await as('authenticated', randoId, async () => {
  await expectError(() => q(`select public.set_kit_received($1, true)`, [r1.registration_id]), /not authorized/, 'non-staff cannot mark the reg kit');
});
await as('authenticated', scannerId, async () => {
  await expectError(() => q(`select public.set_kit_received($1, true)`, [r5.registration_id]), /check the guest in/, 'kit cannot be given before check-in');
  const c = (await q(`select public.check_in_manual($1) r`, [r5.registration_id]))[0].r;
  ok(c.result === 'checked_in' && c.kit_received_at === null, 'check-in result includes kit_received_at (null)');
  const k = (await q(`select public.set_kit_received($1, true) r`, [r5.registration_id]))[0].r;
  ok(!!k.kit_received_at, 'scanner marks the kit as given');
  const again = (await q(`select public.check_in_manual($1) r`, [r5.registration_id]))[0].r;
  ok(again.result === 'already_checked_in' && again.kit_received_at === k.kit_received_at, 'already-checked-in result shows the kit time');
  const hit = (await q(`select * from public.search_checkin($1, 'Person 5')`, [eventId]))[0];
  ok(hit?.kit_received_at != null, 'search_checkin returns kit_received_at');
  const s = (await q(`select public.event_stats($1) s`, [eventId]))[0].s;
  ok(s.kit_received === 1 && s.checked_in === 2, 'event_stats counts kits', JSON.stringify({ kit: s.kit_received, in: s.checked_in }));
  const off = (await q(`select public.set_kit_received($1, false) r`, [r5.registration_id]))[0].r;
  ok(off.kit_received_at === null, 'scanner can untick the kit');
  await q(`select public.set_kit_received($1, true)`, [r5.registration_id]);
  await q(`select public.undo_check_in($1)`, [r5.registration_id]);
  const row = await q(`select public.check_in_manual($1) r`, [r5.registration_id]);
  ok(row[0].r.kit_received_at === null, 'undoing a check-in clears the kit');
  await q(`select public.undo_check_in($1)`, [r5.registration_id]);
});
await expectError(() => q(`update registrations set kit_received_at = now() where id = $1`, [r6.registration_id]),
  /kit_requires_checkin/, 'kit_received_at requires a check-in (constraint)');
const kitAudit = await q(`select action from audit_log where action in ('kit_received', 'kit_undo') and registration_id = $1 order by id`, [r5.registration_id]);
ok(JSON.stringify(kitAudit.map((a) => a.action)) === JSON.stringify(['kit_received', 'kit_undo', 'kit_received']), 'kit changes are audited',
  kitAudit.map((a) => a.action).join(','));

out = await decide([r1.registration_id], 'declined');
ok(out[0].outcome === 'checked_in', 'cannot decline someone already checked in');

const audit = await q(`select action, actor_email, meta from audit_log where registration_id = $1 order by id`, [r1.registration_id]);
ok(JSON.stringify(audit.map((a) => a.action)) === JSON.stringify(['register', 'approve', 'check_in']), 'audit trail for registrant', audit.map((a) => a.action).join(','));
ok(audit[2].actor_email === 'door@x.org' && audit[2].meta.method === 'scan', 'check-in audit records scanner + method');
const undoAudit = await q(`select 1 from audit_log where action = 'undo_check_in' and registration_id = $1`, [r3.registration_id]);
ok(undoAudit.length === 1, 'undo check-in is audited');

// ── check-out ──
await as('authenticated', randoId, async () => {
  await expectError(() => q(`select public.check_out($1)`, [r5.ticket_token]), /not authorized/, 'non-staff cannot check out');
});
await as('anon', null, async () => {
  await expectError(() => q(`select public.check_out($1)`, [r5.ticket_token]), /permission denied/, 'anon cannot call check_out');
  await expectError(() => q(`select * from checkout_stations`), /permission denied/, 'anon cannot read the check-out code table');
});
await as('authenticated', scannerId, async () => {
  ok((await q(`select public.check_out($1) r`, [r5.ticket_token]))[0].r.result === 'not_checked_in', 'check-out before check-in → not_checked_in');
  ok((await q(`select public.check_out($1) r`, [r6.ticket_token]))[0].r.result === 'not_approved', 'declined ticket → not_approved at check-out');
  ok((await q(`select public.check_out($1) r`, ['x'.repeat(43)]))[0].r.result === 'invalid', 'unknown ticket → invalid at check-out');
  const first = (await q(`select public.check_in_manual($1) r`, [r5.registration_id]))[0].r;
  const o = (await q(`select public.check_out($1) r`, [r5.ticket_token]))[0].r;
  ok(o.result === 'checked_out' && !!o.checked_out_at && o.full_name === 'Person 5', 'scanner checks a guest out');
  const o2 = (await q(`select public.check_out($1) r`, [r5.ticket_token]))[0].r;
  ok(o2.result === 'already_checked_out' && o2.checked_out_at === o.checked_out_at, 'second check-out scan → already_checked_out with first time');
  const s = (await q(`select public.event_stats($1) s`, [eventId]))[0].s;
  ok(s.checked_out === 1 && s.on_site === s.checked_in - 1, 'event_stats counts checked out and on site', JSON.stringify({ in: s.checked_in, out: s.checked_out, on: s.on_site }));
  const hit = (await q(`select * from public.search_checkin($1, 'Person 5')`, [eventId]))[0];
  ok(hit?.checked_out_at != null, 'search_checkin returns checked_out_at');
  const back = (await q(`select public.check_in($1) r`, [r5.ticket_token]))[0].r;
  ok(back.result === 'checked_in' && back.returned === true && back.checked_out_at === null && back.checked_in_at === first.checked_in_at,
    'scanning back in after check-out → checked_in (returned), first check-in time kept');
  ok((await q(`select public.check_in($1) r`, [r5.ticket_token]))[0].r.result === 'already_checked_in', 'then a repeat scan → already_checked_in');
  ok((await q(`select public.check_out_manual($1) r`, [r5.registration_id]))[0].r.result === 'checked_out', 'manual check-out');
  ok((await q(`select public.undo_check_out($1) r`, [r5.registration_id]))[0].r.ok === true, 'undo check-out');
  ok((await q(`select public.undo_check_out($1) r`, [r5.registration_id]))[0].r.ok === false, 'undo when not checked out → ok:false');
  await expectError(() => q(`select public.checkout_station($1)`, [eventId]), /not authorized/, 'scanner cannot see the check-out poster code');
});

const station = await as('authenticated', adminId, async () => (await q(`select public.checkout_station($1) r`, [eventId]))[0].r);
ok(/^[A-Za-z0-9_-]{43}$/.test(station.code), 'admin gets a 256-bit check-out poster code');
ok((await as('authenticated', adminId, async () => (await q(`select public.checkout_station($1) r`, [eventId]))[0].r)).code === station.code,
  'the poster code stays the same until rotated');
await as('anon', null, async () => {
  const st = (await q(`select public.get_checkout_station($1) r`, [station.code]))[0].r;
  ok(st?.event?.name && !JSON.stringify(st).includes(station.code), 'poster page sees the event name');
  ok((await q(`select public.get_checkout_station('nope') r`))[0].r === null, 'unknown poster code → null');
  const self = (await q(`select public.self_check_out($1, $2) r`, [r5.ticket_token, station.code]))[0].r;
  ok(self.result === 'checked_out' && self.full_name === 'Person 5' && !('registration_id' in self) && !('organization' in self),
    'guest checks themselves out at the poster, and only gets their name back', JSON.stringify(self));
  ok((await q(`select public.self_check_out($1, $2) r`, [r5.ticket_token, station.code]))[0].r.result === 'already_checked_out', 'second self check-out → already_checked_out');
  ok((await q(`select public.self_check_out($1, $2) r`, [r3.ticket_token, station.code]))[0].r.result === 'not_checked_in', 'self check-out before check-in → not_checked_in');
  ok((await q(`select public.self_check_out($1, $2) r`, [r5.ticket_token, 'x'.repeat(43)]))[0].r.result === 'wrong_station', 'self check-out needs the poster code');
  ok((await q(`select public.self_check_out($1, $2) r`, ['x'.repeat(43), station.code]))[0].r.result === 'invalid', 'self check-out with an unknown ticket → invalid');
});
const rotated = await as('authenticated', adminId, async () => (await q(`select public.rotate_checkout_station($1) r`, [eventId]))[0].r);
ok(rotated.code !== station.code, 'admin can rotate the poster code');
await as('anon', null, async () => {
  ok((await q(`select public.self_check_out($1, $2) r`, [r5.ticket_token, station.code]))[0].r.result === 'wrong_station', 'old poster code stops working after rotating');
});
const selfAudit = await q(`select meta from audit_log where action = 'check_out' and registration_id = $1 order by id`, [r5.registration_id]);
ok(selfAudit.map((a) => a.meta.method).join(',') === 'scan,manual,self', 'check-outs are audited with their method', selfAudit.map((a) => a.meta.method).join(','));
await as('authenticated', scannerId, async () => {
  await q(`select public.undo_check_in($1)`, [r5.registration_id]);
});
ok((await q(`select checked_out_at from registrations where id = $1`, [r5.registration_id]))[0].checked_out_at === null, 'undoing a check-in clears the check-out');
await expectError(() => q(`update registrations set checked_out_at = now() where id = $1`, [r6.registration_id]),
  /checkout_requires_checkin/, 'checked_out_at requires a check-in (constraint)');

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

// ── safeguarding email log ──
await q(`insert into email_log (registration_id, type, template, to_email, status) values ($1, 'safeguarding', 'safeguarding', 'p@x.org', 'sent')`, [r1.registration_id]);
ok((await q(`select 1 from email_log where registration_id = $1 and template = 'safeguarding'`, [r1.registration_id])).length === 1, 'email_log accepts the safeguarding email');
await expectError(() => q(`insert into email_log (registration_id, type, template, status) values ($1, 'bogus', 'bogus', 'sent')`, [r1.registration_id]),
  /email_log_type_check|email_log_template_check/, 'email_log still rejects unknown email types');
await q(`insert into email_log (registration_id, type, template, to_email, status) values ($1, 'thank_you', 'thank_you', 'P@X.org', 'sent')`, [r1.registration_id]);
ok((await q(`select 1 from email_log where template = 'thank_you' and status = 'sent' and lower(to_email) = 'p@x.org'`)).length === 1, 'email_log accepts the thank-you email');

// ── no capacity limit ──
await q(`update events set capacity = 1, auto_waitlist = true where id = $1`, [eventId]);
ok((await register(person(9))).status === 'waitlisted', 'with a limit of 1 a new sign-up is waitlisted');
await q(`update events set capacity = null where id = $1`, [eventId]);
const r10 = await register(person(10));
ok(r10.status === 'pending', 'capacity null: no auto-waitlist even with auto_waitlist on');
out = await decide([r10.registration_id], 'approved');
ok(out[0].outcome === 'updated', 'capacity null: approving never returns over_capacity');
const av2 = (await q(`select public.event_availability('yim-2026') a`))[0].a;
ok(av2.is_full === false, 'capacity null: event_availability is never full');
await as('authenticated', adminId, async () => {
  const s = (await q(`select public.event_stats($1) s`, [eventId]))[0].s;
  ok(s.capacity === null && s.remaining === null, 'capacity null: event_stats remaining is null', JSON.stringify({ c: s.capacity, r: s.remaining }));
});

// ── rate limit ──
let allowed = 0;
for (let i = 0; i < 7; i++) if ((await q(`select public.hit_rate_limit('t', 5, 600) a`))[0].a) allowed++;
ok(allowed === 5, 'rate limit allows 5 of 7');

// ── awards ──
const [mpyi] = await q(`select id from awards where event_id = $1 and kind = 'mpyi'`, [eventId]);
const [pc] = await q(`select id from awards where event_id = $1 and kind = 'peoples_choice'`, [eventId]);
ok(!!mpyi && !!pc, 'both awards exist for the event');
const booths = await q(`select booth_no from award_candidates where award_id = $1 order by booth_no`, [pc.id]);
ok(booths.length === 24 && booths[0].booth_no === 1 && booths[23].booth_no === 24, 'seed: 24 booths are People\'s Choice candidates (re-run adds no duplicates)');

await as('anon', null, async () => {
  for (const t of ['awards', 'award_candidates', 'award_voters', 'award_votes']) {
    await expectError(() => q(`select * from ${t}`), /permission denied/, `anon cannot select ${t}`);
  }
  await expectError(() => q(`select public.award_stats($1)`, [pc.id]), /permission denied/, 'anon cannot read award_stats');
  ok((await q(`select public.get_ballot('nope') b`))[0].b === null, 'get_ballot with bad token → null');
});
await as('authenticated', scannerId, async () => {
  ok((await q('select * from award_votes')).length === 0, 'scanner sees no votes');
  await expectError(() => q(`select public.award_stats($1)`, [pc.id]), /not authorized/, 'scanner cannot read award_stats');
  await expectError(() => q(`select public.sync_pc_voters($1)`, [pc.id]), /not authorized/, 'scanner cannot sync voters');
});

let roster;
await as('authenticated', adminId, async () => {
  roster = (await q(`select public.import_award_voters($1, $2::jsonb) r`, [mpyi.id, JSON.stringify([
    { name: 'Ana Cruz', email: 'Ana@Team.org', team: 'Team A', track: 'OCSEA' },
    { name: 'Ben Lim', email: 'ben@team.org', team: 'Team B', track: 'Corporal Punishment', country: 'Philippines', innovation: 'SafeTalk', gender: 'Male' },
    { name: 'Cara Diaz', email: 'cara@team.org', team: 'Team C', track: 'Child Marriage' },
    { name: '', email: 'bad' },
  ])]))[0].r;
  ok(roster.inserted === 3 && roster.errors.length === 1, 'roster import: 3 voters + candidates, bad row reported', JSON.stringify(roster));
  const again = (await q(`select public.import_award_voters($1, $2::jsonb) r`, [mpyi.id, JSON.stringify([
    { name: 'Ana Cruz', email: 'ana@team.org', team: 'Team A+', track: 'OCSEA' },
  ])]))[0].r;
  ok(again.inserted === 0 && again.updated === 1, 're-importing updates instead of duplicating');
  await expectError(() => q(`select public.import_award_voters($1, '[]'::jsonb)`, [pc.id]), /only for the Most Promising/, 'roster import refused for People\'s Choice');
  const sync = (await q(`select public.sync_pc_voters($1) r`, [pc.id]))[0].r;
  const approved = (await q(`select count(*)::int n from registrations where status = 'approved' and event_id = $1`, [eventId]))[0].n;
  ok(sync.added === approved && sync.total === approved, 'sync adds every approved registrant', JSON.stringify({ sync, approved }));
  ok((await q(`select public.sync_pc_voters($1) r`, [pc.id]))[0].r.added === 0, 'syncing again adds nobody');
  await expectError(() => q(`update award_voters set voted_at = now()`), /permission denied/, 'admin cannot write voters directly');
  await expectError(() => q(`insert into award_votes (award_id, voter_id, candidate_id, voter_name) select award_id, id, candidate_self_id, 'x' from award_voters limit 1`),
    /permission denied/, 'admin cannot insert votes directly');
});

const voter = async (award, email) => (await q(`select * from award_voters where award_id = $1 and email = $2`, [award, email]))[0];
const ana = await voter(mpyi.id, 'ana@team.org');
const ben = await voter(mpyi.id, 'ben@team.org');
const vote = (token, cand, name = 'Me', team = 'T', track = 'OCSEA', note = null) =>
  as('anon', null, async () => (await q(`select public.cast_vote($1, $2, $3, $4, $5, $6) r`, [token, cand, name, team, track, note]))[0].r);

ok((await vote(ana.ballot_token, ben.candidate_self_id)).result === 'closed', 'voting is closed until an admin opens the award');
await as('authenticated', adminId, async () => {
  await q(`update awards set is_open = true where id in ($1, $2)`, [mpyi.id, pc.id]);
});

const ballot = await as('anon', null, async () => (await q(`select public.get_ballot($1) b`, [ana.ballot_token]))[0].b);
ok(ballot.award.kind === 'mpyi' && ballot.award.open === true && ballot.voter.team === 'Team A+' && ballot.voted_at === null,
  'get_ballot returns award, prefilled voter fields');
ok(ballot.candidates.length === 2 && !ballot.candidates.some((c) => c.id === ana.candidate_self_id) && !JSON.stringify(ballot.candidates).includes('@') && !('email' in ballot.voter),
  'ballot leaves out the voter themself and exposes no emails');
const benCard = ballot.candidates.find((c) => c.label === 'Ben Lim');
const caraCard = ballot.candidates.find((c) => c.label === 'Cara Diaz');
ok(benCard?.country === 'Philippines' && benCard?.innovation === 'SafeTalk' && benCard?.gender === 'Male' && caraCard?.country === null,
  'ballot shows each innovator\'s country, innovation and gender from the roster (blank when not given)', JSON.stringify(benCard));
await as('authenticated', adminId, async () => {
  await q(`update award_candidates set innovation = 'SafeTalk App' where id = $1`, [ben.candidate_self_id]);
});
ok((await q(`select innovation from award_candidates where id = $1`, [ben.candidate_self_id]))[0].innovation === 'SafeTalk App', 'admin can edit an innovator\'s details');

await expectError(() => vote(ana.ballot_token, ana.candidate_self_id, null, null, null), /vote for yourself/, 'self-vote rejected');
const [pcCandidate] = await q(`select id from award_candidates where award_id = $1 limit 1`, [pc.id]);
await expectError(() => vote(ana.ballot_token, pcCandidate.id, null, null, null),
  /choose one of the options/, 'a candidate from the other award is rejected');
ok((await vote('x'.repeat(43), ben.candidate_self_id)).result === 'invalid', 'bad token → invalid');
const v1 = await vote(ana.ballot_token, ben.candidate_self_id, null, null, null, 'Great pitch');
ok(v1.result === 'voted' && v1.choice === 'Ben Lim', 'MPYI vote recorded from roster details (no About-you fields)', JSON.stringify(v1));
const votedAs = (await q(`select voter_name, voter_team, voter_track from award_votes where voter_id = $1`, [ana.id]))[0];
ok(votedAs.voter_name === 'Ana Cruz' && votedAs.voter_team === 'Team A+' && votedAs.voter_track === 'OCSEA',
  'MPYI vote stores the voters roster name, team and track', JSON.stringify(votedAs));
const v2 = await vote(ana.ballot_token, ben.candidate_self_id, null, null, null);
ok(v2.result === 'already_voted', 'second vote → already_voted');
const after = await as('anon', null, async () => (await q(`select public.get_ballot($1) b`, [ana.ballot_token]))[0].b);
ok(after.voted_at !== null && after.choice === 'Ben Lim', 'ballot shows the vote was cast');

const pcVoters = await q(`select ballot_token, email from award_voters where award_id = $1 order by email`, [pc.id]);
const [booth3] = await q(`select id from award_candidates where award_id = $1 and booth_no = 3`, [pc.id]);
const [booth7] = await q(`select id from award_candidates where award_id = $1 and booth_no = 7`, [pc.id]);
await as('authenticated', adminId, async () => {
  await q(`update award_candidates set hidden = true where id = $1`, [booth7.id]);
});
await expectError(() => vote(pcVoters[0].ballot_token, booth7.id, 'Visitor'), /choose one of the options/, 'hidden candidate rejected');
await q(`update award_voters set name = null where ballot_token = $1`, [pcVoters[2].ballot_token]);
await expectError(() => vote(pcVoters[2].ballot_token, booth3.id, '  '), /enter your name/, 'People\'s Choice needs a name when the registration has none');
const [registered] = await q(`select name from award_voters where ballot_token = $1`, [pcVoters[0].ballot_token]);
const pv = await vote(pcVoters[0].ballot_token, booth3.id, null, null, null, null);
ok(pv.result === 'voted', 'People\'s Choice vote with just a booth tap');
ok((await q(`select v.voter_name from award_votes v join award_voters w on w.id = v.voter_id where w.ballot_token = $1`, [pcVoters[0].ballot_token]))[0].voter_name === registered.name && !!registered.name,
  'People\'s Choice vote uses the registered name', registered.name);
await vote(pcVoters[1].ballot_token, booth3.id, 'Visitor 2');
ok((await q(`select voter_team, voter_track from award_votes where candidate_id = $1 limit 1`, [booth3.id]))[0].voter_team === null,
  'People\'s Choice stores no team/track');

await as('authenticated', adminId, async () => {
  const s = (await q(`select public.award_stats($1) s`, [pc.id]))[0].s;
  ok(s.eligible === pcVoters.length && s.voted === 2 && s.sent === 0 && s.tally[0].candidate_id === booth3.id && s.tally[0].votes === 2
    && s.tally.length === 24, 'award_stats: eligible, voted, tally sorted by votes', JSON.stringify({ e: s.eligible, v: s.voted, top: s.tally[0] }));
  const m = (await q(`select public.award_stats($1) s`, [mpyi.id]))[0].s;
  ok(m.eligible === 3 && m.voted === 1 && m.tally[0].label === 'Ben Lim', 'MPYI stats');
  const votes = await q(`select voter_name, voter_team, note from award_votes where award_id = $1`, [mpyi.id]);
  ok(votes.length === 1 && votes[0].note === 'Great pitch' && votes[0].voter_team === 'Team A+', 'admin reads votes with who voted and why');
  await q(`update awards set is_open = false where id = $1`, [pc.id]);
});
ok((await vote(pcVoters[2].ballot_token, booth3.id, 'Late')).result === 'closed', 'closing the award stops votes');
await as('authenticated', adminId, async () => {
  await q(`update awards set is_open = true, closes_at = now() - interval '1 minute' where id = $1`, [pc.id]);
});
ok((await vote(pcVoters[2].ballot_token, booth3.id, 'Late')).result === 'closed', 'past closes_at counts as closed');
ok((await q(`select 1 from audit_log where action = 'award_vote'`)).length === 3, 'every vote is audited');

// Exit table: staff check a guest out, then open their People's Choice ballot on the organizer device.
const kiosk = (sub, id) => as('authenticated', sub, async () => (await q(`select public.staff_checkout_ballot($1) r`, [id]))[0].r);
await as('authenticated', scannerId, async () => { await q(`select public.check_in_manual($1)`, [r5.registration_id]); });
ok((await kiosk(scannerId, r5.registration_id)).outcome === 'not_checked_out', 'staff ballot: guest still on site → not_checked_out');
await as('authenticated', scannerId, async () => { await q(`select public.check_out_manual($1)`, [r5.registration_id]); });
ok((await kiosk(scannerId, r5.registration_id)).outcome === 'not_open', 'staff ballot: voting closed → not_open');
await as('authenticated', adminId, async () => {
  await q(`update awards set is_open = true, closes_at = null where id = $1`, [pc.id]);
});
const k1 = await kiosk(scannerId, r5.registration_id);
ok(k1.outcome === 'ready' && /^[A-Za-z0-9_-]{43}$/.test(k1.ballot_token) && k1.name === 'P5', 'staff ballot: checked-out guest gets a ballot token for the exit-table tab', JSON.stringify(k1));
ok((await kiosk(scannerId, r5.registration_id)).ballot_token === k1.ballot_token, 'staff ballot: same token every time (one voter row)');
await expectError(() => kiosk(randoId, r5.registration_id), /not authorized/, 'staff ballot: non-staff refused');
await expectError(() => as('anon', null, () => q(`select public.staff_checkout_ballot($1)`, [r5.registration_id])), /permission denied/, 'staff ballot: anon refused');
ok((await vote(k1.ballot_token, booth3.id, null)).result === 'voted', 'staff ballot: guest votes with just a booth tap');
ok((await kiosk(scannerId, r5.registration_id)).outcome === 'already_voted', 'staff ballot: after voting → already_voted (no token)');

await q(`insert into email_log (award_voter_id, type, template, to_email, status) values ($1, 'ballot', 'ballot_mpyi', 'ben@team.org', 'sent')`, [ben.id]);
await q(`insert into email_log (award_voter_id, type, template, to_email, status) values ($1, 'ballot_checkout', 'ballot_peoples_choice', 'ben@team.org', 'sent')`, [ben.id]);
ok((await q(`select 1 from email_log where award_voter_id = $1 and type = 'ballot_checkout'`, [ben.id])).length === 1, 'email_log accepts the check-out ballot email');
await expectError(() => q(`insert into email_log (type, template, status) values ('ballot', 'ballot_mpyi', 'sent')`),
  /email_log_owner_check/, 'email_log rows need a registration or an award voter');

const anonVoters = (await q(`select public.anonymize_event_awards($1) n`, [eventId]))[0].n;
ok(anonVoters === 3 + pcVoters.length && (await q(`select 1 from award_voters where email not like 'anon-%'`)).length === 0
  && (await q(`select 1 from award_votes where note is not null or voter_name <> 'Anonymized'`)).length === 0,
  'anonymize_event_awards strips voters and notes, keeps the tally');

// ── anonymize ──
const n = (await q(`select public.anonymize_event_registrations($1) n`, [eventId]))[0].n;
const leftovers = await q(`select * from registrations where full_name <> 'Anonymized' or email not like 'anon-%' or guardian_email is not null
  or preferred_name is not null or nationality is not null or age is not null or answers <> '{}'::jsonb`);
ok(n === 9 && leftovers.length === 0, 'anonymize strips personal data incl. form answers', `n=${n}`);
ok((await q(`select public.get_ticket($1) t`, [r1.ticket_token]))[0].t === null, 'old ticket links stop working after anonymizing');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
