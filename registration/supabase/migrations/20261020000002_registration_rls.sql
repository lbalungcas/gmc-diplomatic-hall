-- Row Level Security. The public (anon) role can read event details and nothing else;
-- every write goes through an Edge Function (service role) or a role-checked RPC.

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.admin_users where user_id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_staff_role() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_staff_role() is not null
$$;

alter table public.events        enable row level security;
alter table public.registrations enable row level security;
alter table public.admin_users   enable row level security;
alter table public.email_log     enable row level security;
alter table public.audit_log     enable row level security;
alter table public.rate_limits   enable row level security;

-- Belt and braces: anon has no table privileges on personal data at all.
revoke all on public.registrations, public.admin_users, public.email_log, public.audit_log, public.rate_limits from anon;
revoke all on public.rate_limits from authenticated;
-- Staff never write these tables directly; RPCs and Edge Functions do.
revoke insert, update, delete on public.registrations, public.email_log, public.audit_log, public.admin_users from authenticated;
revoke insert, update, delete on public.events from anon;
-- Admins edit event settings directly (RLS below), but the form only via save_form_schema(),
-- which validates and audits the change.
revoke update on public.events from authenticated;
grant update (capacity, registration_opens_at, registration_closes_at, auto_waitlist, contact_email, arrival_note)
  on public.events to authenticated;

-- events: public details (name, date, venue, capacity) are readable by anyone.
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select to anon, authenticated using (true);

drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- registrations: admins only. Scanners use check_in()/search_checkin(), which return no email/phone.
drop policy if exists registrations_admin_read on public.registrations;
create policy registrations_admin_read on public.registrations
  for select to authenticated using (public.is_admin());

-- admin_users: a signed-in user can see their own role; admins can see everyone.
drop policy if exists admin_users_read on public.admin_users;
create policy admin_users_read on public.admin_users
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log
  for select to authenticated using (public.is_admin());

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());

-- rate_limits: no policies → only the service role can touch it.
