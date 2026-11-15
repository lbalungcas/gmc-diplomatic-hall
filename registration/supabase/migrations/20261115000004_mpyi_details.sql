-- Most Promising Young Innovator: extra details per innovator (country, innovation, gender), so voters
-- can pick a delegate by name and check the details before voting. All optional; blank values are
-- simply not shown on the ballot.

alter table public.award_candidates add column if not exists country text check (char_length(country) <= 100);
alter table public.award_candidates add column if not exists innovation text check (char_length(innovation) <= 300);
alter table public.award_candidates add column if not exists gender text check (char_length(gender) <= 50);

revoke update on public.award_candidates from authenticated;
grant update (label, team, track, booth_no, hidden, sort, country, innovation, gender) on public.award_candidates to authenticated;

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
      select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'team', c.team, 'track', c.track, 'booth_no', c.booth_no,
                                          'country', c.country, 'innovation', c.innovation, 'gender', c.gender)
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

-- Roster rows: { name, email, team, track, country, innovation, gender }. Each becomes both a voter and a
-- candidate. Re-importing updates the details; voters who already voted keep their ballot.
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
  v_country text;
  v_innovation text;
  v_gender text;
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
    v_country := left(nullif(trim(coalesce(v_row->>'country', '')), ''), 100);
    v_innovation := left(nullif(trim(coalesce(v_row->>'innovation', '')), ''), 300);
    v_gender := left(nullif(trim(coalesce(v_row->>'gender', '')), ''), 50);
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'error', 'needs a name and a valid email');
      continue;
    end if;
    begin
      insert into public.award_candidates (award_id, label, team, track, email, country, innovation, gender)
      values (p_award, v_name, v_team, v_track, v_email, v_country, v_innovation, v_gender)
      on conflict (award_id, email) do update
        set label = excluded.label, team = excluded.team, track = excluded.track,
            country = excluded.country, innovation = excluded.innovation, gender = excluded.gender
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

revoke execute on function public.get_ballot(text), public.import_award_voters(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_ballot(text) to anon, authenticated;
grant execute on function public.import_award_voters(uuid, jsonb) to authenticated;

-- Most Promising ballots no longer ask for the voters own details. Name, team and track
-- come from the roster row on award_voters. Peoples Choice still collects the voters name.
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

  if v_award.kind = 'mpyi' then
    v_name := nullif(trim(coalesce(v_voter.name, '')), '');
    v_team := nullif(trim(coalesce(v_voter.team, '')), '');
    v_track := nullif(trim(coalesce(v_voter.track, '')), '');
  end if;

  if v_name is null or char_length(v_name) > 300 then
    raise exception 'Please enter your name.' using errcode = '22023';
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

revoke execute on function public.cast_vote(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.cast_vote(text, uuid, text, text, text, text) to anon, authenticated;
