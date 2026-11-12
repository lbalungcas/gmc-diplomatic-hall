-- On-site registration and reg kit tracking. Re-runnable.
--   1. Capacity becomes optional: null = no limit (no auto-waitlist, no over_capacity on approve).
--   2. "Received Reg Kit?": kit_received_at / kit_received_by, set by door staff after check-in.

-- ───────────────────────────── capacity ─────────────────────────────

alter table public.events alter column capacity drop not null;
alter table public.events drop constraint if exists events_capacity_check;
alter table public.events add constraint events_capacity_check check (capacity is null or capacity > 0);

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
      e.capacity is not null
      and (select count(*) from public.registrations r where r.event_id = e.id and r.status = 'approved') >= e.capacity,
    'auto_waitlist', e.auto_waitlist)
  from public.events e
  where e.slug = p_slug
$$;

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

  if v_event.auto_waitlist and v_event.capacity is not null
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
      if v_capacity is not null
         and (select count(*) from public.registrations where event_id = v_reg.event_id and status = 'approved') >= v_capacity then
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

-- ───────────────────────────── reg kit ─────────────────────────────

alter table public.registrations add column if not exists kit_received_at timestamptz;
alter table public.registrations add column if not exists kit_received_by uuid references auth.users (id) on delete set null;
alter table public.registrations drop constraint if exists kit_requires_checkin;
alter table public.registrations add constraint kit_requires_checkin
  check (kit_received_at is null or checked_in_at is not null);

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
    'checked_in_at', v_reg.checked_in_at,
    'kit_received_at', v_reg.kit_received_at);
end $$;

create or replace function public.undo_check_in(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.registrations;
  v_reg public.registrations;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_before from public.registrations where id = p_id for update;
  update public.registrations
     set checked_in_at = null, checked_in_by = null, kit_received_at = null, kit_received_by = null
   where id = p_id and checked_in_at is not null
  returning * into v_reg;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after)
  values (auth.uid(), public._actor_email(), 'undo_check_in', v_reg.event_id, v_reg.id,
          jsonb_strip_nulls(jsonb_build_object('checked_in_at', v_before.checked_in_at, 'kit_received_at', v_before.kit_received_at)),
          jsonb_build_object('checked_in_at', null));
  return jsonb_build_object('ok', true);
end $$;

-- Door staff tick "Kit given" after a check-in (or untick a mistake). Staff only, audited.
create or replace function public.set_kit_received(p_id uuid, p_received boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_before timestamptz;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_reg from public.registrations where id = p_id and anonymized_at is null for update;
  if not found then
    raise exception 'registration not found' using errcode = 'P0002';
  end if;
  if v_reg.checked_in_at is null then
    raise exception 'check the guest in before giving the reg kit' using errcode = '22023';
  end if;
  v_before := v_reg.kit_received_at;
  if coalesce(p_received, false) = (v_before is not null) then
    return jsonb_build_object('kit_received_at', v_before);
  end if;

  update public.registrations
     set kit_received_at = case when p_received then now() end,
         kit_received_by = case when p_received then auth.uid() end
   where id = p_id
  returning * into v_reg;

  insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after)
  values (auth.uid(), public._actor_email(), case when p_received then 'kit_received' else 'kit_undo' end,
          v_reg.event_id, v_reg.id,
          jsonb_build_object('kit_received_at', v_before),
          jsonb_build_object('kit_received_at', v_reg.kit_received_at));
  return jsonb_build_object('kit_received_at', v_reg.kit_received_at);
end $$;

-- The return type changes, so it has to be dropped first.
drop function if exists public.search_checkin(uuid, text);
create function public.search_checkin(p_event uuid, p_q text)
returns table (
  id uuid,
  full_name text,
  preferred_name text,
  organization text,
  category text,
  status public.registration_status,
  photo_consent boolean,
  checked_in_at timestamptz,
  kit_received_at timestamptz
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
    select r.id, r.full_name, r.preferred_name, r.organization, r.category, r.status, r.photo_consent,
           r.checked_in_at, r.kit_received_at
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
    'kit_received', (select count(*) from regs where kit_received_at is not null),
    'remaining', case when e.capacity is null then null
                      else greatest(e.capacity - (select count(*) from regs where status = 'approved'), 0) end,
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

-- ───────────────────────────── grants ─────────────────────────────

revoke execute on function
  public.event_availability(text),
  public.create_registration(text, jsonb),
  public.decide_registrations(uuid[], public.registration_status, text, boolean, uuid, text),
  public._check_in(uuid, text),
  public.undo_check_in(uuid),
  public.set_kit_received(uuid, boolean),
  public.search_checkin(uuid, text),
  public.event_stats(uuid)
from public, anon, authenticated;

grant execute on function public.event_availability(text) to anon, authenticated;

grant execute on function
  public.undo_check_in(uuid),
  public.set_kit_received(uuid, boolean),
  public.search_checkin(uuid, text),
  public.event_stats(uuid)
to authenticated;
