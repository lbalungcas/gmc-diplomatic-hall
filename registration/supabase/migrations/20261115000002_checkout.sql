-- Check-out: guests scan a printed QR code at the exit with their own phone, or door staff scan
-- their ticket in check-out mode. A guest who comes back is checked in again by the normal scan.
--
--   public (anon):        get_checkout_station, self_check_out
--   staff:                check_out, check_out_manual, undo_check_out
--   admin:                checkout_station, rotate_checkout_station

alter table public.registrations add column if not exists checked_out_at timestamptz;
alter table public.registrations add column if not exists checked_out_by uuid references auth.users (id) on delete set null;
alter table public.registrations drop constraint if exists checkout_requires_checkin;
alter table public.registrations add constraint checkout_requires_checkin
  check (checked_out_at is null or checked_in_at is not null);

-- The exit poster's code. Kept out of `events`, which anyone can read. Admins see it via
-- checkout_station() and can rotate it if a photo of the poster gets shared.
create table if not exists public.checkout_stations (
  event_id    uuid primary key references public.events (id) on delete cascade,
  code        text not null unique default public.new_ticket_token(),
  rotated_at  timestamptz not null default now()
);
alter table public.checkout_stations enable row level security;
revoke all on public.checkout_stations from anon, authenticated;

-- ───────────────────────────── check-in (re-entry) ─────────────────────────────

create or replace function public._check_in(p_id uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_result text;
  v_returned boolean := false;
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

  if not found then
    -- A guest who checked out and comes back: keep the first check-in time, clear the check-out.
    update public.registrations
       set checked_out_at = null, checked_out_by = null
     where id = p_id
       and status = 'approved'
       and checked_out_at is not null
       and anonymized_at is null
    returning * into v_reg;
    v_returned := found;
  end if;

  if v_reg.id is not null then
    insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after, meta)
    values (auth.uid(), public._actor_email(), 'check_in', v_reg.event_id, v_reg.id,
            case when v_returned then jsonb_build_object('checked_out', true) else jsonb_build_object('checked_in_at', null) end,
            jsonb_build_object('checked_in_at', v_reg.checked_in_at),
            jsonb_strip_nulls(jsonb_build_object('method', p_method, 'returned', case when v_returned then true end)));
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
    'returned', v_returned,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'full_name', v_reg.full_name,
    'preferred_name', v_reg.preferred_name,
    'organization', v_reg.organization,
    'category', v_reg.category,
    'status', v_reg.status,
    'photo_consent', v_reg.photo_consent,
    'checked_in_at', v_reg.checked_in_at,
    'checked_out_at', v_reg.checked_out_at,
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
     set checked_in_at = null, checked_in_by = null, kit_received_at = null, kit_received_by = null,
         checked_out_at = null, checked_out_by = null
   where id = p_id and checked_in_at is not null
  returning * into v_reg;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after)
  values (auth.uid(), public._actor_email(), 'undo_check_in', v_reg.event_id, v_reg.id,
          jsonb_strip_nulls(jsonb_build_object('checked_in_at', v_before.checked_in_at, 'kit_received_at', v_before.kit_received_at,
                                               'checked_out_at', v_before.checked_out_at)),
          jsonb_build_object('checked_in_at', null));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── check-out ─────────────────────────────

-- Result: checked_out | already_checked_out | not_checked_in | not_approved | invalid.
create or replace function public._check_out(p_id uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_result text;
begin
  update public.registrations
     set checked_out_at = now(), checked_out_by = auth.uid()
   where id = p_id
     and checked_in_at is not null
     and checked_out_at is null
     and anonymized_at is null
  returning * into v_reg;

  if found then
    insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after, meta)
    values (auth.uid(), public._actor_email(), 'check_out', v_reg.event_id, v_reg.id,
            jsonb_build_object('checked_out_at', null),
            jsonb_build_object('checked_out_at', v_reg.checked_out_at),
            jsonb_build_object('method', p_method));
    v_result := 'checked_out';
  else
    select * into v_reg from public.registrations where id = p_id and anonymized_at is null;
    if not found then
      return jsonb_build_object('result', 'invalid');
    end if;
    v_result := case
      when v_reg.checked_out_at is not null then 'already_checked_out'
      when v_reg.status <> 'approved' then 'not_approved'
      else 'not_checked_in' end;
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
    'checked_out_at', v_reg.checked_out_at,
    'kit_received_at', v_reg.kit_received_at);
end $$;

create or replace function public.check_out(p_token text)
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
  return public._check_out(v_id, 'scan');
end $$;

create or replace function public.check_out_manual(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public._check_out(p_id, 'manual');
end $$;

create or replace function public.undo_check_out(p_id uuid)
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
  select checked_out_at into v_before from public.registrations where id = p_id for update;
  update public.registrations
     set checked_out_at = null, checked_out_by = null
   where id = p_id and checked_out_at is not null
  returning * into v_reg;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.audit_log (actor, actor_email, action, event_id, registration_id, before, after)
  values (auth.uid(), public._actor_email(), 'undo_check_out', v_reg.event_id, v_reg.id,
          jsonb_build_object('checked_out_at', v_before), jsonb_build_object('checked_out_at', null));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── self check-out (exit poster) ─────────────────────────────

-- Lets the poster page say whether the code is current, without revealing anything else.
create or replace function public.get_checkout_station(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('event', jsonb_build_object('name', e.name, 'contact_email', e.contact_email, 'timezone', e.timezone))
  from public.checkout_stations s
  join public.events e on e.id = s.event_id
  where char_length(p_code) between 20 and 100 and s.code = p_code
$$;

-- Both values are 256-bit secrets: the ticket proves who, the poster code proves they're at the exit.
-- Result: checked_out | already_checked_out | not_checked_in | not_approved | invalid | wrong_station.
create or replace function public.self_check_out(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_station public.checkout_stations;
  v_out jsonb;
begin
  if p_code is null or char_length(p_code) not between 20 and 100 then
    return jsonb_build_object('result', 'wrong_station');
  end if;
  select * into v_station from public.checkout_stations where code = p_code;
  if not found then
    return jsonb_build_object('result', 'wrong_station');
  end if;
  if p_token is null or char_length(p_token) not between 20 and 100 then
    return jsonb_build_object('result', 'invalid');
  end if;
  select * into v_reg from public.registrations where ticket_token = p_token and anonymized_at is null;
  if not found then
    return jsonb_build_object('result', 'invalid');
  end if;
  if v_reg.event_id <> v_station.event_id then
    return jsonb_build_object('result', 'wrong_station');
  end if;

  v_out := public._check_out(v_reg.id, 'self');
  -- Guests only get their own name and times back.
  return jsonb_build_object(
    'result', v_out->>'result',
    'full_name', v_out->>'full_name',
    'preferred_name', v_out->>'preferred_name',
    'checked_in_at', v_out->'checked_in_at',
    'checked_out_at', v_out->'checked_out_at');
end $$;

-- ───────────────────────────── admin: the poster code ─────────────────────────────

create or replace function public.checkout_station(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.checkout_stations;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.checkout_stations (event_id) values (p_event) on conflict (event_id) do nothing;
  select * into v_station from public.checkout_stations where event_id = p_event;
  return jsonb_build_object('code', v_station.code, 'rotated_at', v_station.rotated_at);
end $$;

create or replace function public.rotate_checkout_station(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.checkout_stations;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.checkout_stations (event_id) values (p_event)
  on conflict (event_id) do update set code = public.new_ticket_token(), rotated_at = now()
  returning * into v_station;
  insert into public.audit_log (actor, actor_email, action, event_id)
  values (auth.uid(), public._actor_email(), 'rotate_checkout_code', p_event);
  return jsonb_build_object('code', v_station.code, 'rotated_at', v_station.rotated_at);
end $$;

-- ───────────────────────────── read paths that now include check-out ─────────────────────────────

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
    'checked_out_at', r.checked_out_at,
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
  kit_received_at timestamptz,
  checked_out_at timestamptz
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
           r.checked_in_at, r.kit_received_at, r.checked_out_at
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
    'checked_out', (select count(*) from regs where checked_out_at is not null),
    'on_site', (select count(*) from regs where checked_in_at is not null and checked_out_at is null),
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
  public._check_in(uuid, text),
  public.undo_check_in(uuid),
  public._check_out(uuid, text),
  public.check_out(text),
  public.check_out_manual(uuid),
  public.undo_check_out(uuid),
  public.get_checkout_station(text),
  public.self_check_out(text, text),
  public.checkout_station(uuid),
  public.rotate_checkout_station(uuid),
  public.get_ticket(text),
  public.search_checkin(uuid, text),
  public.event_stats(uuid)
from public, anon, authenticated;

grant execute on function
  public.get_checkout_station(text),
  public.self_check_out(text, text),
  public.get_ticket(text)
to anon, authenticated;

grant execute on function
  public.undo_check_in(uuid),
  public.check_out(text),
  public.check_out_manual(uuid),
  public.undo_check_out(uuid),
  public.checkout_station(uuid),
  public.rotate_checkout_station(uuid),
  public.search_checkin(uuid, text),
  public.event_stats(uuid)
to authenticated;
