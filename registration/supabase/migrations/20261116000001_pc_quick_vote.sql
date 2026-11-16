-- Peoples Choice quick vote: guests land on the booth map straight after checking out and
-- only tap a booth. When the ballot sends no name, the vote uses the name already on the
-- voter row (copied from the registration). Most Promising keeps using the roster details.
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
  else
    v_name := coalesce(v_name, nullif(trim(coalesce(v_voter.name, '')), ''));
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
