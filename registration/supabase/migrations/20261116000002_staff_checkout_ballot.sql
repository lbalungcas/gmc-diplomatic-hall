-- Peoples Choice at the exit table: after staff check a guest out, the organizer device opens
-- that guest ballot in a new tab so they vote on the spot. Staff only. Adds the guest as a
-- voter if Sync approved registrants has not yet, and returns their ballot token. No email.
create or replace function public.staff_checkout_ballot(p_registration uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_award public.awards;
  v_voter public.award_voters;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_reg from public.registrations where id = p_registration;
  if not found or v_reg.anonymized_at is not null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_reg.status <> 'approved' or v_reg.checked_out_at is null then
    return jsonb_build_object('outcome', 'not_checked_out');
  end if;

  select * into v_award from public.awards where event_id = v_reg.event_id and kind = 'peoples_choice';
  if not found or not public._award_is_open(v_award) then
    return jsonb_build_object('outcome', 'not_open');
  end if;

  insert into public.award_voters (award_id, email, name, registration_id)
  values (v_award.id, lower(v_reg.email), coalesce(nullif(v_reg.preferred_name, ''), v_reg.full_name), v_reg.id)
  on conflict (award_id, email) do nothing;

  select * into v_voter from public.award_voters where award_id = v_award.id and email = lower(v_reg.email);
  if v_voter.voted_at is not null then
    return jsonb_build_object('outcome', 'already_voted', 'name', v_voter.name);
  end if;
  return jsonb_build_object('outcome', 'ready', 'name', v_voter.name, 'ballot_token', v_voter.ballot_token);
end $$;

revoke execute on function public.staff_checkout_ballot(uuid) from public, anon, authenticated;
grant execute on function public.staff_checkout_ballot(uuid) to authenticated;
