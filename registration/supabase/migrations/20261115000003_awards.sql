-- YIM Awards: two invite-only ballots, one vote per email each.
--   mpyi            Most Promising Young Innovator. Voters and candidates are the youth innovator
--                   roster imported by an admin; nobody can vote for themselves.
--   peoples_choice  Peoples Choice of Innovation. Voters are approved registrants; candidates
--                   are the booths (seed.sql).
-- Voters get a personal ballot link (/register/vote/<token>) by email. The token is the only thing
-- that identifies them, so anon can only reach the ballot through get_ballot() and cast_vote().
-- Re-runnable.

do $$ begin
  create type public.award_kind as enum ('mpyi', 'peoples_choice');
exception when duplicate_object then null; end $$;

create table if not exists public.awards (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  kind        public.award_kind not null,
  title       text not null check (char_length(title) between 1 and 200),
  is_open     boolean not null default false,
  opens_at    timestamptz,
  closes_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, kind)
);

create table if not exists public.award_candidates (
  id          uuid primary key default gen_random_uuid(),
  award_id    uuid not null references public.awards (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 300),
  team        text check (char_length(team) <= 300),
  track       text check (char_length(track) <= 200),
  booth_no    integer check (booth_no between 1 and 999),
  -- MPYI candidates are roster people; their email links them to their own ballot (no self-votes).
  email       text check (email = lower(email) and char_length(email) <= 254),
  hidden      boolean not null default false,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists award_candidates_booth_key on public.award_candidates (award_id, booth_no);
create unique index if not exists award_candidates_email_key on public.award_candidates (award_id, email);

create table if not exists public.award_voters (
  id                 uuid primary key default gen_random_uuid(),
  award_id           uuid not null references public.awards (id) on delete cascade,
  email              text not null check (email = lower(email) and char_length(email) <= 254),
  name               text check (char_length(name) <= 300),
  team               text check (char_length(team) <= 300),
  track              text check (char_length(track) <= 200),
  registration_id    uuid references public.registrations (id) on delete set null,
  candidate_self_id  uuid references public.award_candidates (id) on delete set null,
  ballot_token       text not null unique default public.new_ticket_token(),
  sent_at            timestamptz,
  voted_at           timestamptz,
  created_at         timestamptz not null default now(),
  unique (award_id, email)
);
create index if not exists award_voters_award_idx on public.award_voters (award_id, created_at);

create table if not exists public.award_votes (
  id            uuid primary key default gen_random_uuid(),
  award_id      uuid not null references public.awards (id) on delete cascade,
  voter_id      uuid not null unique references public.award_voters (id) on delete cascade,
  candidate_id  uuid not null references public.award_candidates (id) on delete restrict,
  voter_name    text not null check (char_length(voter_name) between 1 and 300),
  voter_team    text check (char_length(voter_team) <= 300),
  voter_track   text check (char_length(voter_track) <= 200),
  note          text check (char_length(note) <= 500),
  created_at    timestamptz not null default now()
);
create index if not exists award_votes_award_idx on public.award_votes (award_id, created_at desc);

drop trigger if exists awards_touch on public.awards;
create trigger awards_touch before update on public.awards
  for each row execute function public.touch_updated_at();

-- One row per award for every event (the dashboard expects both).
insert into public.awards (event_id, kind, title)
select e.id, k.kind, k.title
  from public.events e
 cross join (values ('mpyi'::public.award_kind, 'Most Promising Young Innovator'),
                    ('peoples_choice'::public.award_kind, 'People''s Choice of Innovation')) as k (kind, title)
on conflict (event_id, kind) do nothing;

-- Ballot emails are logged in email_log next to the registration emails. Roster innovators may
-- not have a registration, so a row belongs to a registration or to an award voter.
alter table public.email_log alter column registration_id drop not null;
alter table public.email_log add column if not exists award_voter_id uuid references public.award_voters (id) on delete cascade;
create index if not exists email_log_award_voter_idx on public.email_log (award_voter_id, sent_at desc);
alter table public.email_log drop constraint if exists email_log_owner_check;
alter table public.email_log add constraint email_log_owner_check
  check (registration_id is not null or award_voter_id is not null);
alter table public.email_log drop constraint if exists email_log_type_check;
alter table public.email_log add constraint email_log_type_check
  check (type in ('pending', 'approved', 'declined', 'waitlisted', 'resend', 'safeguarding', 'ballot', 'ballot_reminder', 'ballot_checkout'));
alter table public.email_log drop constraint if exists email_log_template_check;
alter table public.email_log add constraint email_log_template_check
  check (template in ('pending', 'approved', 'declined', 'waitlisted', 'safeguarding', 'ballot_mpyi', 'ballot_peoples_choice'));

-- ───────────────────────────── RLS ─────────────────────────────

alter table public.awards           enable row level security;
alter table public.award_candidates enable row level security;
alter table public.award_voters     enable row level security;
alter table public.award_votes      enable row level security;

revoke all on public.awards, public.award_candidates, public.award_voters, public.award_votes from anon;
-- Admins open/close awards and edit candidates directly; voters and votes only change through RPCs.
revoke insert, delete on public.awards from authenticated;
revoke update on public.awards from authenticated;
grant update (title, is_open, opens_at, closes_at) on public.awards to authenticated;
revoke delete on public.award_candidates from authenticated;
revoke update on public.award_candidates from authenticated;
grant update (label, team, track, booth_no, hidden, sort) on public.award_candidates to authenticated;
revoke insert, update, delete on public.award_voters, public.award_votes from authenticated;

drop policy if exists awards_admin_read on public.awards;
create policy awards_admin_read on public.awards for select to authenticated using (public.is_admin());
drop policy if exists awards_admin_update on public.awards;
create policy awards_admin_update on public.awards for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists award_candidates_admin_read on public.award_candidates;
create policy award_candidates_admin_read on public.award_candidates for select to authenticated using (public.is_admin());
drop policy if exists award_candidates_admin_insert on public.award_candidates;
create policy award_candidates_admin_insert on public.award_candidates for insert to authenticated with check (public.is_admin());
drop policy if exists award_candidates_admin_update on public.award_candidates;
create policy award_candidates_admin_update on public.award_candidates for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists award_voters_admin_read on public.award_voters;
create policy award_voters_admin_read on public.award_voters for select to authenticated using (public.is_admin());

drop policy if exists award_votes_admin_read on public.award_votes;
create policy award_votes_admin_read on public.award_votes for select to authenticated using (public.is_admin());

-- ───────────────────────────── functions ─────────────────────────────

create or replace function public._award_is_open(a public.awards)
returns boolean
language sql
stable
set search_path = ''
as $$
  select a.is_open
     and (a.opens_at is null or now() >= a.opens_at)
     and (a.closes_at is null or now() <= a.closes_at)
$$;

-- The ballot for one voter. Returns null for an unknown token. Never exposes other voters.
create or replace function public.get_ballot(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'award', jsonb_build_object(
      'kind', a.kind,
      'title', a.title,
      'open', public._award_is_open(a),
      'closes_at', a.closes_at),
    'event', jsonb_build_object('name', e.name, 'contact_email', e.contact_email),
    'voter', jsonb_build_object('name', v.name, 'team', v.team, 'track', v.track),
    'voted_at', v.voted_at,
    'choice', (select c.label from public.award_votes x join public.award_candidates c on c.id = x.candidate_id
                where x.voter_id = v.id),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'team', c.team, 'track', c.track, 'booth_no', c.booth_no)
                       order by c.sort, c.booth_no nulls last, c.label)
        from public.award_candidates c
       where c.award_id = a.id
         and not c.hidden
         and c.id is distinct from v.candidate_self_id), '[]'::jsonb))
  from public.award_voters v
  join public.awards a on a.id = v.award_id
  join public.events e on e.id = a.event_id
  where char_length(p_token) between 20 and 100
    and v.ballot_token = p_token
$$;

-- One vote per ballot, final. Returns { result: voted | already_voted | closed | invalid }.
create or replace function public.cast_vote(
  p_token text, p_candidate uuid, p_name text, p_team text, p_track text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voter public.award_voters;
  v_award public.awards;
  v_cand public.award_candidates;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_team text := nullif(trim(coalesce(p_team, '')), '');
  v_track text := nullif(trim(coalesce(p_track, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_token is null or char_length(p_token) not between 20 and 100 then
    return jsonb_build_object('result', 'invalid');
  end if;
  -- Row lock: a double-submit from two tabs serializes here and the second sees voted_at.
  select * into v_voter from public.award_voters where ballot_token = p_token for update;
  if not found then
    return jsonb_build_object('result', 'invalid');
  end if;
  if v_voter.voted_at is not null then
    return jsonb_build_object('result', 'already_voted', 'voted_at', v_voter.voted_at);
  end if;
  select * into v_award from public.awards where id = v_voter.award_id;
  if not public._award_is_open(v_award) then
    return jsonb_build_object('result', 'closed');
  end if;

  if v_name is null or char_length(v_name) > 300 then
    raise exception 'Please enter your name.' using errcode = '22023';
  end if;
  if v_award.kind = 'mpyi' and (v_team is null or v_track is null) then
    raise exception 'Please enter your team and thematic track.' using errcode = '22023';
  end if;
  if char_length(v_team) > 300 or char_length(v_track) > 200 then
    raise exception 'Team or track is too long.' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Please keep your note under 500 characters.' using errcode = '22023';
  end if;

  select * into v_cand from public.award_candidates where id = p_candidate and award_id = v_award.id and not hidden;
  if not found then
    raise exception 'Please choose one of the options on the ballot.' using errcode = '22023';
  end if;
  if v_cand.id = v_voter.candidate_self_id then
    raise exception 'You can''t vote for yourself.' using errcode = '22023';
  end if;

  insert into public.award_votes (award_id, voter_id, candidate_id, voter_name, voter_team, voter_track, note)
  values (v_award.id, v_voter.id, v_cand.id, v_name,
          case when v_award.kind = 'mpyi' then v_team end,
          case when v_award.kind = 'mpyi' then v_track end,
          v_note);
  update public.award_voters set voted_at = now() where id = v_voter.id returning voted_at into v_voter.voted_at;

  insert into public.audit_log (action, event_id, registration_id, meta)
  values ('award_vote', v_award.event_id, v_voter.registration_id,
          jsonb_build_object('award', v_award.kind, 'voter_id', v_voter.id, 'candidate_id', v_cand.id));

  return jsonb_build_object('result', 'voted', 'voted_at', v_voter.voted_at, 'choice', v_cand.label);
end $$;

create or replace function public.award_stats(p_award uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'eligible', (select count(*) from public.award_voters where award_id = a.id),
    'sent', (select count(*) from public.award_voters where award_id = a.id and sent_at is not null),
    'voted', (select count(*) from public.award_votes where award_id = a.id),
    'open', public._award_is_open(a),
    'tally', coalesce((
      select jsonb_agg(t order by t.votes desc, t.label)
        from (
          select c.id as candidate_id, c.label, c.team, c.track, c.booth_no, c.hidden,
                 (select count(*) from public.award_votes x where x.candidate_id = c.id) as votes
            from public.award_candidates c
           where c.award_id = a.id
        ) t), '[]'::jsonb))
  into v_result
  from public.awards a
  where a.id = p_award;
  return v_result;
end $$;

-- Most Promising roster: each row { name, email, team, track } becomes both a voter and a candidate.
-- Re-importing updates names/teams/tracks; voters who already voted keep their ballot.
create or replace function public.import_award_voters(p_award uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.awards;
  v_row jsonb;
  v_index integer := 0;
  v_email text;
  v_name text;
  v_team text;
  v_track text;
  v_cand uuid;
  v_new boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_award from public.awards where id = p_award;
  if not found or v_award.kind <> 'mpyi' then
    raise exception 'The roster is only for the Most Promising Young Innovator award.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Send between 1 and 2000 rows.' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_email := lower(trim(coalesce(v_row->>'email', '')));
    v_name := nullif(trim(coalesce(v_row->>'name', '')), '');
    v_team := nullif(trim(coalesce(v_row->>'team', '')), '');
    v_track := nullif(trim(coalesce(v_row->>'track', '')), '');
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'error', 'needs a name and a valid email');
      continue;
    end if;
    begin
      insert into public.award_candidates (award_id, label, team, track, email)
      values (p_award, v_name, v_team, v_track, v_email)
      on conflict (award_id, email) do update set label = excluded.label, team = excluded.team, track = excluded.track
      returning id into v_cand;

      insert into public.award_voters (award_id, email, name, team, track, candidate_self_id)
      values (p_award, v_email, v_name, v_team, v_track, v_cand)
      on conflict (award_id, email) do update
        set name = excluded.name, team = excluded.team, track = excluded.track, candidate_self_id = excluded.candidate_self_id
      returning (xmax = 0) into v_new;

      if v_new then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'error', sqlerrm);
    end;
  end loop;

  insert into public.audit_log (actor, actor_email, action, event_id, meta)
  values (auth.uid(), public._actor_email(), 'award_import_roster', v_award.event_id,
          jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'errors', jsonb_array_length(v_errors)));
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'errors', v_errors);
end $$;

-- Peoples Choice voters: every approved registrant of the event. Safe to press again; it only adds.
create or replace function public.sync_pc_voters(p_award uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.awards;
  v_added integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_award from public.awards where id = p_award;
  if not found or v_award.kind <> 'peoples_choice' then
    raise exception 'Syncing registrants is only for the People''s Choice award.' using errcode = '22023';
  end if;

  insert into public.award_voters (award_id, email, name, registration_id)
  select p_award, r.email, coalesce(nullif(r.preferred_name, ''), r.full_name), r.id
    from public.registrations r
   where r.event_id = v_award.event_id
     and r.status = 'approved'
     and r.anonymized_at is null
  on conflict (award_id, email) do nothing;
  get diagnostics v_added = row_count;

  insert into public.audit_log (actor, actor_email, action, event_id, meta)
  values (auth.uid(), public._actor_email(), 'award_sync_voters', v_award.event_id, jsonb_build_object('added', v_added));
  return jsonb_build_object('added', v_added,
                            'total', (select count(*) from public.award_voters where award_id = p_award));
end $$;

-- Data retention: run with anonymize_event_registrations. Keeps the tallies, drops who voted.
create or replace function public.anonymize_event_awards(p_event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.award_votes x
     set voter_name = 'Anonymized', voter_team = null, voter_track = null, note = null
    from public.awards a
   where x.award_id = a.id and a.event_id = p_event;
  update public.award_voters v
     set email = 'anon-' || v.id || '@invalid.local', name = null, team = null, track = null,
         ballot_token = public.new_ticket_token()
    from public.awards a
   where v.award_id = a.id and a.event_id = p_event and v.email not like 'anon-%';
  get diagnostics v_count = row_count;
  update public.award_candidates c set email = null
    from public.awards a where c.award_id = a.id and a.event_id = p_event;
  insert into public.audit_log (action, event_id, meta) values ('anonymize_awards', p_event, jsonb_build_object('voters', v_count));
  return v_count;
end $$;

-- ───────────────────────────── grants ─────────────────────────────

revoke execute on function
  public._award_is_open(public.awards),
  public.get_ballot(text),
  public.cast_vote(text, uuid, text, text, text, text),
  public.award_stats(uuid),
  public.import_award_voters(uuid, jsonb),
  public.sync_pc_voters(uuid),
  public.anonymize_event_awards(uuid)
from public, anon, authenticated;

grant execute on function
  public.get_ballot(text),
  public.cast_vote(text, uuid, text, text, text, text)
to anon, authenticated;

grant execute on function
  public.award_stats(uuid),
  public.import_award_voters(uuid, jsonb),
  public.sync_pc_voters(uuid)
to authenticated;

-- ───────────────────────────── realtime ─────────────────────────────
-- The dashboard subscribes to these tables; RLS limits the change feed to admins.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.award_votes;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.award_voters;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
