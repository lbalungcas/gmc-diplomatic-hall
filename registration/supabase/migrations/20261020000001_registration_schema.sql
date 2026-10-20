-- Youth Innovations Marketplace — registration, approval & QR check-in.
-- Lives alongside the 3D hall tables (analytics_events, booths, …) in the same project.

create extension if not exists pgcrypto with schema extensions;

-- 256-bit, URL-safe, unguessable ticket token. Never the row id.
create or replace function public.new_ticket_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_')
$$;

do $$ begin
  create type public.registration_status as enum ('pending', 'approved', 'declined', 'waitlisted', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.staff_role as enum ('admin', 'scanner');
exception when duplicate_object then null; end $$;

create table if not exists public.events (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  subtitle                text,
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null,
  timezone                text not null default 'Asia/Manila',
  venue                   text not null,
  venue_address           text,
  map_url                 text,
  contact_email           text not null,
  arrival_note            text,
  capacity                integer not null check (capacity > 0),
  registration_opens_at   timestamptz,
  registration_closes_at  timestamptz,
  auto_waitlist           boolean not null default true,
  -- The registration form (sections, questions, options). Null = the built-in default form
  -- (supabase/functions/_shared/form.ts). Edited in the admin Form editor via save_form_schema().
  form_schema             jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.registrations (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events (id) on delete cascade,
  ticket_token         text not null unique default public.new_ticket_token(),
  status               public.registration_status not null default 'pending',
  source               text not null default 'form' check (source in ('form', 'import', 'seed')),
  full_name            text not null check (char_length(full_name) between 1 and 300),
  preferred_name       text check (char_length(preferred_name) <= 300),
  email                text not null check (email = lower(email) and char_length(email) <= 254),
  phone                text check (char_length(phone) <= 40),
  organization         text check (char_length(organization) <= 300),
  -- Free text: the options come from the (editable) form's category question.
  category             text check (char_length(category) <= 1000),
  country              text check (char_length(country) <= 300),
  nationality          text check (char_length(nationality) <= 300),
  age                  integer check (age between 1 and 120),
  age_group            text check (age_group in ('under-18', '18-24', '25+')),
  guardian_name        text check (char_length(guardian_name) <= 200),
  guardian_email       text check (char_length(guardian_email) <= 254),
  guardian_consent     boolean not null default false,
  photo_consent        boolean not null default false,
  privacy_consent      boolean not null default false,
  -- Every form answer, keyed by question id (radio → string, checkbox → string[]).
  -- The columns above are copies of the answers to the questions linked to them.
  answers              jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 100000),
  decline_reason       text check (char_length(decline_reason) <= 500),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  decided_at           timestamptz,
  decided_by           uuid references auth.users (id) on delete set null,
  checked_in_at        timestamptz,
  checked_in_by        uuid references auth.users (id) on delete set null,
  anonymized_at        timestamptz,

  -- The public form always collects these; imported Google Form rows may not.
  constraint form_fields_required check (
    source <> 'form' or anonymized_at is not null or (privacy_consent and age is not null)
  ),
  -- Safeguarding: under-18s registering online must give a parent/guardian's name, email and
  -- consent. Imported rows (the old Google Form didn't ask) are let in but can't be approved
  -- until an admin records guardian consent — see decide_registrations().
  constraint minors_need_guardian check (
    age_group is distinct from 'under-18' or anonymized_at is not null or source <> 'form'
    or (guardian_name is not null and guardian_email is not null and guardian_consent)
  ),
  constraint checkin_requires_approval check (checked_in_at is null or status = 'approved')
);

create unique index if not exists registrations_event_email_key on public.registrations (event_id, email);
create index if not exists registrations_event_status_idx on public.registrations (event_id, status);
create index if not exists registrations_event_created_idx on public.registrations (event_id, created_at desc);

create table if not exists public.admin_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        public.staff_role not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.email_log (
  id                   bigint generated always as identity primary key,
  registration_id      uuid not null references public.registrations (id) on delete cascade,
  type                 text not null check (type in ('pending', 'approved', 'declined', 'waitlisted', 'resend')),
  template             text not null check (template in ('pending', 'approved', 'declined', 'waitlisted')),
  to_email             text,
  provider_message_id  text,
  status               text not null check (status in ('sent', 'failed', 'skipped')),
  error                text,
  sent_at              timestamptz not null default now()
);
create index if not exists email_log_registration_idx on public.email_log (registration_id, sent_at desc);

create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  actor            uuid references auth.users (id) on delete set null,
  actor_email      text,
  action           text not null,
  event_id         uuid references public.events (id) on delete cascade,
  registration_id  uuid references public.registrations (id) on delete set null,
  before           jsonb,
  after            jsonb,
  meta             jsonb
);
create index if not exists audit_log_registration_idx on public.audit_log (registration_id, at desc);
create index if not exists audit_log_event_idx on public.audit_log (event_id, at desc);

create table if not exists public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

drop trigger if exists registrations_touch on public.registrations;
create trigger registrations_touch before update on public.registrations
  for each row execute function public.touch_updated_at();
