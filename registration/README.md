# YIM Registration & QR Check-in

Registration, approval and door check-in for the **Youth Innovations Marketplace**: *Scalable Solutions to End Violence Against Children*. The event is on 17 November 2026 in the Diplomatic Hall, Marriott Hotel Manila.

The system replaces the "Pre-Registration to the General Public" Google Form on the main site. It is part of the **main website**: the same Netlify site and domain, served under **`/register`**. The main site's build also builds this folder into `dist/register/` (see `../netlify.toml`), so there's no extra domain, DNS record or Netlify site. The staff pages sit at `/register/admin`, apart from the main site's own `/admin` booth manager.

Staff sign in with an email and password. **That login is what protects the data**, because the database only lets signed-in staff read registrations (row-level security). The staff pages aren't linked from anywhere and aren't indexed by search engines, but they're not secret. The staff code is loaded only when someone opens `/register/admin`.

| Route (under `youthinnovationsmarketplace.org/register`) | Who | What |
|---|---|---|
| `/` | Public | Registration form: the Violence Ends With Us visitor pre-registration form, 9 sections |
| `/t/:token` | The registrant | Ticket page. Shows the status, plus the QR code and calendar button once approved |
| `/admin/login` | Staff | Email + password sign-in, "Forgot password?" |
| `/admin/password` | Staff | Choose a password (after an invite or reset link) or change it |
| `/admin` | Admin | Stats, registrant table, approve/decline, CSV import/export |
| `/admin/checkin` | Admin, scanner | Manual check-in by name, undo |
| `/admin/scan` | Admin, scanner | Camera QR scanner for the door |
| `/admin/form` | Admin | **Form editor**: edit sections, questions, options, images and branching. Includes preview and version history |
| `/admin/settings` | Admin | Capacity, registration window, auto-waitlist, contact email |

## How it works

```
Browser (React + Vite + Tailwind)            Supabase (the existing hall project)
──────────────────────────────────           ─────────────────────────────────────────────
Register form ── POST ─────────────────────▶ Edge Function: register
                                               Turnstile check → rate limit → create_registration()
                                               → "pending" (or "waitlisted") email via Resend
Ticket page ─── rpc get_ticket(token) ──────▶ returns name + status only, never contact details
Admin table ─── select registrations ───────▶ allowed by RLS for admins only
Approve/decline ─ POST ─────────────────────▶ Edge Function: decide → decide_registrations()
                                               → confirmed email with inline QR + .ics, or decline email
Scanner ─────── rpc check_in(token) ────────▶ atomic UPDATE … WHERE checked_in_at IS NULL
```

- **Approval first:** the QR code only leaves the server in the "You're confirmed" email, and only shows on the ticket page once the registrant is approved.
- **QR contents:** `https://youthinnovationsmarketplace.org/register/t/<token>`. The token is 256 random bits and is never the row id. The QR holds no personal data.
- **Atomic check-in:** if two phones scan the same code at the same moment, the second one gets **Already checked in**.
- **Capacity** counts *approved* registrants. Approving past capacity asks the admin to confirm, and the override is recorded in the audit log. When **auto-waitlist** is on and the event is full, new sign-ups go straight to the waitlist.
- **Audit log:** every registration, approve, decline, waitlist, check-in, undo, resend, import and export is recorded. The registrant drawer shows that history together with the email delivery log.

## The registration form

The form shipped in the code is the Google Form **"Violence Ends With Us: Visitor Pre-Registration Form for Youth Innovations Marketplace 2026"**.
- All 9 sections, 25 questions, every option, the option images and the text blocks are reproduced word for word. A script checked 94 strings against the live Google Form and none differed.
- It's defined once, in `supabase/functions/_shared/form.ts` (`DEFAULT_FORM`). The browser and the `register` function use the same code, so they validate answers identically.
- Pages work like Google Forms: one section at a time, with Back and Next. **Deal Corner → "No, I am not interested"** skips section 7 (the match-making questions).
- Text formatting uses a tiny Markdown subset: `**bold**`, `[link](https://…)`, `- ` bullets, and a blank line for a new paragraph.

**Editing (Admin → Form).** Admins can do the following, and changes go live when they click **Save & publish**:
- Edit any title, description, question or option.
- Add, remove or reorder sections, questions and options.
- Change answer types and required flags, add "Other:" choices and option images.
- Set "go to section" jumps.

Before saving, the editor:
- refuses a form that would break registration (no email question, a jump to a deleted section, duplicate options, …);
- offers **Preview**, which shows the form exactly as registrants see it.

Every saved version goes into the audit log, and **Version history** can load any earlier one. **Restore the original form** goes back to the built-in version.

**Answers and registration fields.** Every answer is stored in `registrations.answers` (JSON, keyed by question id). Some questions also feed a column the system uses (full name, preferred name, email, mobile, organization, category, country, nationality, age). You set this per question with **Saves to registration field**.
- Full name, email and age must always be linked to a required question.
- Editing or removing a question never changes answers already submitted. Answers to removed questions still appear in the CSV export.

**Added by the system on every form.** These sit outside the editor:
- The data privacy notice with a required consent box (RA 10173), and an optional photo/filming consent box. Both appear on the last page.
- For anyone whose Age is under 18, a **Parent / Guardian Consent** step right after the Age question: guardian name, email and consent.

The Google Form had neither of these. Without them the scanner's photo-consent flag and the child-safeguarding rule wouldn't work.

### Code map

```
src/
  pages/Register.tsx, Ticket.tsx           public pages (Register = multi-page form stepper)
  components/FormSection.tsx, RichText.tsx renders one form section / the Markdown subset (no raw HTML)
  pages/admin/                             Login, Dashboard (+ drawer, import, decline), FormEditor, CheckIn, Scan, Settings
  lib/                                     Supabase client, auth/role guard, CSV, formatting
public/form/                               the six "Marketplace spaces" option images from the Google Form
supabase/
  migrations/                              schema → RLS → database functions (all re-runnable)
  seed.sql                                 the 17 Nov event
  functions/register | decide | resend-email | import-registrations
  functions/_shared/form.ts                the form engine + DEFAULT_FORM (shared with the browser)
  functions/_shared/                       email.ts (provider wrapper), templates.ts, qr.ts, ics.ts, validate.ts
  tests/db.test.mjs                        69 RLS/RPC checks against an in-memory Postgres (PGlite)
  tests/form.test.mjs                      23 form-engine checks (validation, branching, editor guards)
scripts/seed-fake.mjs                      fake registrants for testing / load test
```

## Setup

### 1. Database (the existing hall Supabase project)

The new tables (`events`, `registrations`, `admin_users`, `email_log`, `audit_log`, `rate_limits`) sit alongside the hall's tables and don't touch them.

```bash
cd registration
npm install
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                     # applies supabase/migrations/*
# Then run supabase/seed.sql once in Dashboard → SQL Editor (creates the 17 Nov event).
```

If you don't use the CLI, paste the three migration files and `seed.sql`, in order, into the SQL Editor.

### 2. Auth (staff sign-in by email + password)

In Dashboard → Authentication:

- **Sign In / Providers → Email:** turn **off** "Allow new users to sign up". Admins and scanners are invited and can't sign themselves up.
  *Check first that nothing else in the hall project relies on Supabase Auth sign-ups. Today the hall uses only the service role, so it shouldn't.*
- **Sign In / Providers → Email:** keep Email enabled, and set **Minimum password length** to 10, which matches the app.
- **URL Configuration:**
  - Site URL: `https://youthinnovationsmarketplace.org/register/admin`. Invite emails land here, and the app then asks the person to choose a password.
  - Redirect URLs: add `https://youthinnovationsmarketplace.org/register/admin/password`, plus `http://localhost:5174/register/admin/password` for reset links during development.
  - *The Site URL is shared with the hall project. The hall doesn't use Supabase Auth today, so changing it is safe.*
- **SMTP Settings:** Supabase's built-in mailer only sends a few emails per hour, which is enough for the occasional invite or password reset. For reliability, point it at Resend (host `smtp.resend.com`, port 465, user `resend`, password = your Resend API key).

Sessions refresh automatically, so staff stay signed in on a device until they sign out.

### 3. Email (Resend)

1. Create a Resend account and add the domain `youthinnovationsmarketplace.org`, or a subdomain such as `mail.youthinnovationsmarketplace.org`.
2. Add the SPF, DKIM and DMARC DNS records Resend shows you, and wait until the domain shows **Verified**.
3. Create an API key with "Sending access".

Resend's default rate limit is 2 emails per second. The `decide` function paces its sends to stay under it, and the dashboard sends bulk approvals in chunks of 50, so approving 200 people takes about 2 minutes.

To change provider, add a class to `supabase/functions/_shared/email.ts`. Nothing else calls Resend directly.

### 4. Bot protection (Cloudflare Turnstile)

Create a Turnstile widget for `youthinnovationsmarketplace.org` (and `localhost` for development). The site key goes to Netlify and the secret key goes to Supabase.

### 5. Edge Function secrets and deploy

Create `supabase/.env` (it is gitignored):

```
APP_URL=https://youthinnovationsmarketplace.org/register
EXTRA_ALLOWED_ORIGINS=http://localhost:5174
EVENT_SLUG=yim-2026
RESEND_API_KEY=re_...
EMAIL_FROM=Youth Innovations Marketplace <register@youthinnovationsmarketplace.org>
TURNSTILE_SECRET_KEY=0x...
```

```bash
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy register decide resend-email import-registrations --no-verify-jwt
```

`--no-verify-jwt` is intentional. The new publishable keys aren't JWTs, so each admin function checks the caller's role itself with `requireAdmin()`.

The **service role key, Resend key and Turnstile secret exist only as Supabase secrets.** None of them go in Netlify or the frontend bundle.

### 6. Frontend (the main site's Netlify deploy)

Nothing new to create. `../netlify.toml` already has everything needed:
- It runs `npm run build:site --prefix registration` after the main build, which writes this app to `dist/register/`.
- It sends every `/register/*` page to the app (single-page-app fallback).
- It adds a `noindex` header on `/register/admin/*`.

The main site's "Pre-Registration to the General Public" buttons (`../index.html` header and mobile menu, `../innovator-guidelines/index.html`) link to `/register/`.

In the **main site's** Netlify environment variables, add the following (all safe to expose):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_EVENT_SLUG=yim-2026`
- `VITE_TURNSTILE_SITE_KEY`

Then push, and Netlify deploys both together.

### 7. Add admins and scanners

1. Dashboard → Authentication → Users → **Add user**, then either:
   - **Create new user**: enter their email and a temporary password, and tick **Auto Confirm User**. Give them the password in person. They can change it with **Change password** in the top bar.
   - **Send invitation**: they get an email, open it, and choose their own password.
2. In the SQL Editor, run one of:
   ```sql
   select public.add_staff('coordinator@example.org', 'admin');
   select public.add_staff('door1@example.org', 'scanner');
   ```
3. They sign in at `https://youthinnovationsmarketplace.org/register/admin/login` with their email and password. "Forgot password?" emails a reset link.

To remove someone: `update admin_users set active = false where email = '…';`. This takes effect immediately, even on a device that is still signed in. After the event, also delete door volunteers in Authentication → Users.

| | Admin | Scanner |
|---|---|---|
| See registrant list, emails, phones | ✓ | ✗. Scanners only see name, organization, category and photo consent |
| Approve / decline / waitlist, resend email | ✓ | ✗ |
| Import / export CSV, settings | ✓ | ✗ |
| Scan, manual check-in, undo check-in | ✓ | ✓ |

These rules are enforced in the database (RLS and role checks inside each function) and in the Edge Functions. The client-side route guards only affect the UI.

## Local development

```bash
cp .env.example .env        # fill in VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                 # http://localhost:5173/register/ (staff: /register/admin)
```

When `RESEND_API_KEY` is unset, the functions log emails instead of sending them, and the email log records them as `skipped`. Without a Turnstile site key, the form skips the human check. In that case the `register` function needs `ALLOW_NO_TURNSTILE=true`. **Never set that in production.**

## Testing

```bash
npm run typecheck           # frontend
npm test                    # test:form (form engine, 23 checks) + test:db (69 checks)
npm run test:db             # migrations + RLS + all RPCs in an in-memory Postgres
npx deno check --node-modules-dir=none --no-config supabase/functions/*/index.ts
npm run seed:fake           # 20 fake registrants (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env)
npm run seed:fake -- 300    # load test
```

`test:db` covers:
- anon can't read registrations, the audit log or admins
- a scanner can't approve, export or see contact details
- the duplicate check ignores email case
- under-18s need guardian details online; imported under-18s can't be approved until consent is recorded
- form edits go only through the audited `save_form_schema()`, and scanners can't edit the form
- approvals respect capacity, with an override
- auto-waitlist when full
- the check-in result states (`checked_in` / `already_checked_in` / `not_approved` / `invalid`) and undo
- the audit trail, import errors, rate limiting and anonymization

All fake registrants use `@example.org` addresses. Remove them with `delete from registrations where email like '%@example.org';`.

### Importing the Google Form responses

In Google Forms → **Responses** → ⋮ → **Download responses (.csv)**, then go to Admin → **Import CSV**.
- Columns are matched to questions by their text. Check the matches, and confirm that the original form covered consent.
- Rows are added as **Pending** without any email. Duplicates (same email) are skipped.
- Under-18s are imported but flagged **"guardian consent needed"**, because the Google Form didn't ask for a guardian. Approval stays blocked until an admin records the guardian's name and email and confirms consent in the registrant's details.

### Before launch (Phase 5 checklist)

- [ ] In **Admin → Form → Preview**, read every section against the Google Form one last time.
- [ ] Register on a phone and confirm the pending email arrives within a minute with **no QR**.
- [ ] Register as a 16-year-old and confirm the guardian step appears after Age.
- [ ] Answer "No" to the Deal Corner question and confirm section 7 is skipped.
- [ ] Register again with the same email and confirm you see "already registered" and the email is re-sent.
- [ ] Approve and confirm the email shows the QR inline in **Gmail, Outlook and iOS Mail**, the .ics opens, and the ticket page now shows the QR.
- [ ] Decline with a reason and confirm the email and ticket page show it.
- [ ] Scan the same QR on **two phones at once** (iPhone Safari + Android Chrome): exactly one shows ✓ Checked in.
- [ ] Scan pending and declined codes: both show red **Not approved**.
- [ ] Test the scanner on mobile data, not just Wi-Fi.
- [ ] Run `seed:fake -- 300` and confirm the dashboard, filters and export stay quick.
- [ ] Give the door team `DOOR-STAFF-GUIDE.md` and do a dry run.

## Data retention (90 days)

The privacy notice promises that personal data is deleted or anonymized **90 days after the event, on or after 15 February 2027**. On that date:

```sql
-- 1. Export anything needed for reporting first.
-- 2. Then:
select public.anonymize_event_registrations((select id from events where slug = 'yim-2026'));
```

This removes names, preferred names, emails, phones, organizations, nationality, exact age, guardian details, **all form answers** and decline reasons, clears addresses from the email log, and invalidates every ticket link. Category, country, age group, status and check-in time stay for anonymous statistics.

To schedule it automatically, enable the `pg_cron` extension and run:

```sql
select cron.schedule('yim-anonymize', '0 2 15 2 *',
  $$select public.anonymize_event_registrations((select id from events where slug = 'yim-2026'))$$);
-- After it has run once: select cron.unschedule('yim-anonymize');
```

Also delete any exported CSVs, and the Resend logs (Resend keeps them about 30 days by default), by the same date.

Requests to access, correct or delete data under RA 10173 go to the event contact email. Edit or delete the row in the dashboard's SQL editor; the admin UI is read-only for registrant fields.

## Known limitations

- No offline scan queue (the stretch goal). If the connection drops, the scanner shows "No connection — scan again". The fallback is manual check-in by name once the connection is back.
- Registrants can't edit or cancel their own registration. They email the contact address and an admin changes it.
- One event per deployment (`VITE_EVENT_SLUG` / `EVENT_SLUG`). The schema already supports more events, for example the 14 Nov Youth Prep Workshop.
