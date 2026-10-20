-- Database functions. Three groups, each with its own EXECUTE grants at the bottom:
--   public  (anon):           get_ticket, event_availability
--   staff   (authenticated):  check_in, check_in_manual, undo_check_in, search_checkin, event_stats, log_export,
--                             save_form_schema (admin)
--                             — each re-checks the caller's role, since every signed-in user is "authenticated"
--   service (Edge Functions): create_registration, decide_registrations, import_registrations,
--                             hit_rate_limit, anonymize_event_registrations, add_staff

create or replace function public._actor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select email from public.admin_users where user_id = auth.uid()
$$;

create or replace function public.age_group_for(p_age integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_age is null then null when p_age < 18 then 'under-18' when p_age <= 24 then '18-24' else '25+' end
$$;

-- ───────────────────────────── public ─────────────────────────────

-- Ticket page lookup. The token is 256 bits, so this cannot be used to enumerate registrants.
create or replace function public.get_ticket(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', r.full_name,
    'preferred_name', r.preferred_name,
    'organization', r.organization,
    'category', r.category,
    'status', r.status,
    'checked_in_at', r.checked_in_at,
    'decline_reason', r.decline_reason,
    'event', jsonb_build_object(
      'name', e.name,
      'subtitle', e.subtitle,
      'starts_at', e.starts_at,
      'ends_at', e.ends_at,
      'timezone', e.timezone,
      'venue', e.venue,
      'venue_address', e.venue_address,
      'map_url', e.map_url,
      'contact_email', e.contact_email,
      'arrival_note', e.arrival_note))
  from public.registrations r
  join public.events e on e.id = r.event_id
  where char_length(p_token) between 20 and 100
    and r.ticket_token = p_token
    and r.anonymized_at is null
$$;

-- Lets the form say "registration is closed" / "you'll be waitlisted" without exposing counts.
create or replace function public.event_availability(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration_open',
      (e.registration_opens_at is null or now() >= e.registration_opens_at)
      and (e.registration_closes_at is null or now() <= e.registration_closes_at),
    'is_full',
      (select count(*) from public.registrations r where r.event_id = e.id and r.status = 'approved') >= e.capacity,
    'auto_waitlist', e.auto_waitlist)
  from public.events e
  where e.slug = p_slug
$$;

-- ───────────────────────────── staff ─────────────────────────────

create or replace function public._check_in(p_id uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_result text;
begin
  -- Conditional UPDATE: two phones scanning the same code at once serialize on the row lock,
  -- and the second one re-evaluates the WHERE clause and matches nothing.
  update public.registrations
     set checked_in_at = now(), checked_in_by = auth.uid()
   where id = p_id
     and status = 'approved'
     and checked_in_at is null
     and anonymized_at is null
  returning * into v_reg;

  if found then
    insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after, meta)
    values (auth.uid(), public._actor_email(), 'check_in', v_reg.event_id, v_reg.id,
            jsonb_build_object('checked_in_at', null),
            jsonb_build_object('checked_in_at', v_reg.checked_in_at),
            jsonb_build_object('method', p_method));
    v_result := 'checked_in';
  else
    select * into v_reg from public.registrations where id = p_id and anonymized_at is null;
    if not found then
      return jsonb_build_object('result', 'invalid');
    end if;
    v_result := case when v_reg.status <> 'approved' then 'not_approved' else 'already_checked_in' end;
  end if;

  return jsonb_build_object(
    'result', v_result,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'full_name', v_reg.full_name,
    'preferred_name', v_reg.preferred_name,
    'organization', v_reg.organization,
    'category', v_reg.category,
    'status', v_reg.status,
    'photo_consent', v_reg.photo_consent,
    'checked_in_at', v_reg.checked_in_at);
end $$;

create or replace function public.check_in(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 100 then
    return jsonb_build_object('result', 'invalid');
  end if;
  select id into v_id from public.registrations where ticket_token = p_token;
  if v_id is null then
    return jsonb_build_object('result', 'invalid');
  end if;
  return public._check_in(v_id, 'scan');
end $$;

create or replace function public.check_in_manual(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public._check_in(p_id, 'manual');
end $$;

create or replace function public.undo_check_in(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before timestamptz;
  v_reg public.registrations;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select checked_in_at into v_before from public.registrations where id = p_id for update;
  update public.registrations
     set checked_in_at = null, checked_in_by = null
   where id = p_id and checked_in_at is not null
  returning * into v_reg;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after)
  values (auth.uid(), public._actor_email(), 'undo_check_in', v_reg.event_id, v_reg.id,
          jsonb_build_object('checked_in_at', v_before),
          jsonb_build_object('checked_in_at', null));
  return jsonb_build_object('ok', true);
end $$;

-- Manual check-in search for door staff. Deliberately returns no email or phone.
create or replace function public.search_checkin(p_event uuid, p_q text)
returns table (
  id uuid,
  full_name text,
  preferred_name text,
  organization text,
  category text,
  status public.registration_status,
  photo_consent boolean,
  checked_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_q is null or char_length(trim(p_q)) < 2 then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select r.id, r.full_name, r.preferred_name, r.organization, r.category, r.status, r.photo_consent, r.checked_in_at
    from public.registrations r
    where r.event_id = p_event
      and r.anonymized_at is null
      and r.status <> 'cancelled'
      and (r.full_name ilike v_pattern or r.preferred_name ilike v_pattern or r.organization ilike v_pattern)
    order by r.full_name
    limit 25;
end $$;

create or replace function public.event_stats(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with regs as (
    select * from public.registrations where event_id = p_event and anonymized_at is null
  )
  select jsonb_build_object(
    'capacity', e.capacity,
    'total', (select count(*) from regs where status <> 'cancelled'),
    'pending', (select count(*) from regs where status = 'pending'),
    'approved', (select count(*) from regs where status = 'approved'),
    'declined', (select count(*) from regs where status = 'declined'),
    'waitlisted', (select count(*) from regs where status = 'waitlisted'),
    'cancelled', (select count(*) from regs where status = 'cancelled'),
    'checked_in', (select count(*) from regs where checked_in_at is not null),
    'remaining', greatest(e.capacity - (select count(*) from regs where status = 'approved'), 0),
    'by_category', coalesce((
      select jsonb_agg(c order by c.total desc)
      from (
        select coalesce(category, 'Not specified') as category,
               count(*) filter (where status <> 'cancelled') as total,
               count(*) filter (where status = 'pending') as pending,
               count(*) filter (where status = 'approved') as approved,
               count(*) filter (where status = 'declined') as declined,
               count(*) filter (where status = 'waitlisted') as waitlisted,
               count(*) filter (where checked_in_at is not null) as checked_in
        from regs
        group by 1
      ) c), '[]'::jsonb))
  into v_result
  from public.events e
  where e.id = p_event;

  return v_result;
end $$;

create or replace function public.log_export(p_event uuid, p_count integer, p_filters jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.audit_log (actor, actor_email, action, event_id, meta)
  values (auth.uid(), public._actor_email(), 'export', p_event,
          jsonb_build_object('rows', p_count, 'filters', p_filters));
end $$;

-- Saves the registration form. The admin editor runs the full validation (validateSchema in
-- _shared/form.ts) before calling this; here we only guard the shape and record the change.
-- p_schema = null resets to the built-in default form.
create or replace function public.save_form_schema(p_event uuid, p_schema jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_schema is not null and (
       jsonb_typeof(p_schema) <> 'object'
       or (p_schema ->> 'version') is distinct from '1'
       or jsonb_typeof(p_schema -> 'sections') is distinct from 'array'
       or jsonb_array_length(p_schema -> 'sections') = 0
       or pg_column_size(p_schema) > 500000) then
    raise exception 'invalid form schema' using errcode = '22023';
  end if;
  select form_schema into v_before from public.events where id = p_event for update;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  update public.events set form_schema = p_schema where id = p_event;
  -- The previous version stays in the audit log, so an admin can restore it.
  insert into public.audit_log (actor, actor_email, action, event_id, before, after)
  values (auth.uid(), public._actor_email(), case when p_schema is null then 'reset_form' else 'edit_form' end,
          p_event, v_before, p_schema);
end $$;

-- ───────────────────────────── service ─────────────────────────────

create or replace function public.create_registration(p_event_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_existing public.registrations;
  v_reg public.registrations;
  v_status public.registration_status := 'pending';
  v_email text := lower(trim(p ->> 'email'));
begin
  -- Locking the event row serializes sign-ups, so the capacity check below can't race.
  select * into v_event from public.events where slug = p_event_slug for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if (v_event.registration_opens_at is not null and now() < v_event.registration_opens_at)
     or (v_event.registration_closes_at is not null and now() > v_event.registration_closes_at) then
    return jsonb_build_object('outcome', 'closed');
  end if;

  select * into v_existing from public.registrations where event_id = v_event.id and email = v_email;
  if found then
    return jsonb_build_object('outcome', 'duplicate', 'registration_id', v_existing.id, 'status', v_existing.status);
  end if;

  if v_event.auto_waitlist
     and (select count(*) from public.registrations where event_id = v_event.id and status = 'approved') >= v_event.capacity then
    v_status := 'waitlisted';
  end if;

  insert into public.registrations (
    event_id, status, source, full_name, preferred_name, email, phone, organization, category, country,
    nationality, age, age_group, guardian_name, guardian_email, guardian_consent,
    photo_consent, privacy_consent, answers)
  values (
    v_event.id, v_status, 'form', p ->> 'full_name', p ->> 'preferred_name', v_email, p ->> 'phone',
    p ->> 'organization', p ->> 'category', p ->> 'country', p ->> 'nationality',
    (p ->> 'age')::integer, public.age_group_for((p ->> 'age')::integer),
    p ->> 'guardian_name', lower(p ->> 'guardian_email'), coalesce((p ->> 'guardian_consent')::boolean, false),
    coalesce((p ->> 'photo_consent')::boolean, false), coalesce((p ->> 'privacy_consent')::boolean, false),
    coalesce(p -> 'answers', '{}'::jsonb))
  returning * into v_reg;

  insert into public.audit_log (action, event_id, registration_id, after, meta)
  values ('register', v_event.id, v_reg.id, jsonb_build_object('status', v_reg.status), jsonb_build_object('source', 'form'));

  return jsonb_build_object('outcome', 'created', 'registration_id', v_reg.id, 'status', v_reg.status, 'ticket_token', v_reg.ticket_token);
end $$;

-- Approve / decline / waitlist one or many registrations. Returns one outcome per id:
-- updated | unchanged | over_capacity | needs_guardian | checked_in | not_found.
create or replace function public.decide_registrations(
  p_ids uuid[],
  p_decision public.registration_status,
  p_reason text,
  p_force boolean,
  p_actor uuid,
  p_actor_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results jsonb := '[]'::jsonb;
  v_reg public.registrations;
  v_capacity integer;
  v_id uuid;
begin
  if p_decision not in ('pending', 'approved', 'declined', 'waitlisted') then
    raise exception 'unsupported decision %', p_decision;
  end if;

  -- Lock the affected events so two admins approving at once can't overshoot capacity.
  perform 1 from public.events e
   where e.id in (select r.event_id from public.registrations r where r.id = any (p_ids))
   order by e.id
   for update;

  foreach v_id in array p_ids loop
    select * into v_reg from public.registrations where id = v_id and anonymized_at is null for update;
    if not found then
      v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'not_found');
      continue;
    end if;
    if v_reg.status = p_decision then
      v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'unchanged');
      continue;
    end if;
    if v_reg.checked_in_at is not null then
      v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'checked_in');
      continue;
    end if;
    if p_decision = 'approved' and v_reg.age_group = 'under-18' and not v_reg.guardian_consent then
      v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'needs_guardian');
      continue;
    end if;
    if p_decision = 'approved' and not coalesce(p_force, false) then
      select capacity into v_capacity from public.events where id = v_reg.event_id;
      if (select count(*) from public.registrations where event_id = v_reg.event_id and status = 'approved') >= v_capacity then
        v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'over_capacity');
        continue;
      end if;
    end if;

    update public.registrations
       set status = p_decision,
           decided_at = now(),
           decided_by = p_actor,
           decline_reason = case when p_decision = 'declined' then nullif(trim(p_reason), '') end
     where id = v_id;

    insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after, meta)
    values (p_actor, p_actor_email,
            case p_decision when 'approved' then 'approve' when 'declined' then 'decline'
                            when 'waitlisted' then 'waitlist' else 'reset_pending' end,
            v_reg.event_id, v_id,
            jsonb_build_object('status', v_reg.status),
            jsonb_strip_nulls(jsonb_build_object('status', p_decision,
              'decline_reason', case when p_decision = 'declined' then nullif(trim(p_reason), '') end)),
            case when coalesce(p_force, false) then jsonb_build_object('over_capacity_override', true) end);

    v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'updated');
  end loop;

  return v_results;
end $$;

-- Bulk import (e.g. the Google Form pre-registrations). Rows are pre-validated by the Edge
-- Function; any row that still violates a constraint is reported instead of aborting the batch.
create or replace function public.import_registrations(p_event uuid, p_rows jsonb, p_actor uuid, p_actor_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_index integer := 0;
  v_id uuid;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_id := null;
    begin
      insert into public.registrations (
        event_id, status, source, full_name, preferred_name, email, phone, organization, category, country,
        nationality, age, age_group, guardian_name, guardian_email, guardian_consent,
        photo_consent, privacy_consent, answers, created_at)
      values (
        p_event, 'pending', 'import', v_row ->> 'full_name', v_row ->> 'preferred_name',
        lower(trim(v_row ->> 'email')), v_row ->> 'phone', v_row ->> 'organization', v_row ->> 'category',
        v_row ->> 'country', v_row ->> 'nationality', (v_row ->> 'age')::integer,
        public.age_group_for((v_row ->> 'age')::integer),
        v_row ->> 'guardian_name', lower(v_row ->> 'guardian_email'),
        coalesce((v_row ->> 'guardian_consent')::boolean, false),
        coalesce((v_row ->> 'photo_consent')::boolean, false),
        coalesce((v_row ->> 'privacy_consent')::boolean, false),
        coalesce(v_row -> 'answers', '{}'::jsonb),
        coalesce((v_row ->> 'created_at')::timestamptz, now()))
      on conflict (event_id, email) do nothing
      returning id into v_id;

      if v_id is null then
        v_duplicates := v_duplicates + 1;
      else
        v_inserted := v_inserted + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'error', sqlerrm);
    end;
  end loop;

  insert into public.audit_log (actor, actor_email, action, event_id, meta)
  values (p_actor, p_actor_email, 'import', p_event,
          jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'errors', jsonb_array_length(v_errors)));

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'errors', v_errors);
end $$;

-- Fixed-window counter. Returns true while the caller is under p_max hits in the window.
create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end $$;

-- Data retention (see README): strip personal data but keep aggregate stats
-- (category, country, age group, status, check-in time). Also invalidates every ticket link.
-- Free-text form answers can hold personal data, so they are removed too.
create or replace function public.anonymize_event_registrations(p_event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.registrations
     set full_name = 'Anonymized',
         preferred_name = null,
         email = 'anon-' || id || '@invalid.local',
         phone = null,
         organization = null,
         nationality = null,
         age = null,
         guardian_name = null,
         guardian_email = null,
         answers = '{}'::jsonb,
         decline_reason = null,
         ticket_token = public.new_ticket_token(),
         anonymized_at = now()
   where event_id = p_event and anonymized_at is null;
  get diagnostics v_count = row_count;

  update public.email_log l
     set to_email = null, error = null
    from public.registrations r
   where l.registration_id = r.id and r.event_id = p_event;

  insert into public.audit_log (action, event_id, meta)
  values ('anonymize', p_event, jsonb_build_object('rows', v_count));
  return v_count;
end $$;

-- Grant a signed-in Supabase Auth user a staff role. Run from the SQL editor:
--   select public.add_staff('someone@example.org', 'scanner');
create or replace function public.add_staff(p_email text, p_role public.staff_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No Supabase Auth user with email %. Invite them first (Authentication → Users → Invite).', p_email;
  end if;
  insert into public.admin_users (user_id, email, role, active)
  values (v_user, lower(trim(p_email)), p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true, email = excluded.email;
  return format('%s is now %s', p_email, p_role);
end $$;

-- ───────────────────────────── grants ─────────────────────────────

revoke execute on function
  public._actor_email(),
  public._check_in(uuid, text),
  public.get_ticket(text),
  public.event_availability(text),
  public.check_in(text),
  public.check_in_manual(uuid),
  public.undo_check_in(uuid),
  public.search_checkin(uuid, text),
  public.event_stats(uuid),
  public.log_export(uuid, integer, jsonb),
  public.save_form_schema(uuid, jsonb),
  public.create_registration(text, jsonb),
  public.decide_registrations(uuid[], public.registration_status, text, boolean, uuid, text),
  public.import_registrations(uuid, jsonb, uuid, text),
  public.hit_rate_limit(text, integer, integer),
  public.anonymize_event_registrations(uuid),
  public.add_staff(text, public.staff_role),
  public.new_ticket_token()
from public, anon, authenticated;

grant execute on function
  public.get_ticket(text),
  public.event_availability(text)
to anon, authenticated;

grant execute on function
  public.check_in(text),
  public.check_in_manual(uuid),
  public.undo_check_in(uuid),
  public.search_checkin(uuid, text),
  public.event_stats(uuid),
  public.log_export(uuid, integer, jsonb),
  public.save_form_schema(uuid, jsonb)
to authenticated;

-- Records parent/guardian consent collected offline (e.g. for under-18s imported from the old
-- Google Form, which didn't ask). Admin only; audited.
create or replace function public.record_guardian_consent(p_id uuid, p_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_email), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'guardian name and a valid email are required' using errcode = '22023';
  end if;
  update public.registrations
     set guardian_name = trim(p_name), guardian_email = lower(trim(p_email)), guardian_consent = true
   where id = p_id and anonymized_at is null;
  if not found then
    raise exception 'registration not found' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, actor_email, action, event_id, registration_id, after)
  select auth.uid(), public._actor_email(), 'guardian_consent', event_id, id,
         jsonb_build_object('guardian_consent', true)
    from public.registrations where id = p_id;
end $$;

revoke execute on function public.record_guardian_consent(uuid, text, text) from public, anon;
grant execute on function public.record_guardian_consent(uuid, text, text) to authenticated;
