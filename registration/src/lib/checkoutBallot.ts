import { publicUrl } from './paths';
import { callFunction, supabase } from './supabase';

export interface CheckoutBallot {
  outcome: 'sent' | 'skipped' | 'failed' | 'already_sent' | 'already_voted' | 'not_open' | 'not_checked_out';
  /** Only returned to the guest themselves (ticket token path). */
  ballot_token?: string;
}

/** After a guest checks themselves out: emails the People's Choice ballot once and returns it to vote now. */
export async function guestCheckoutBallot(ticketToken: string): Promise<CheckoutBallot | null> {
  try {
    return await callFunction<CheckoutBallot>('checkout-ballot', { token: ticketToken });
  } catch {
    return null;
  }
}

/** Where to send a guest who just checked out: straight to their ballot while voting is open and they have not voted. */
export function checkoutVotePath(ballot: CheckoutBallot | null): string | null {
  if (!ballot?.ballot_token || ballot.outcome === 'already_voted') return null;
  return `/vote/${ballot.ballot_token}?from=checkout`;
}

export type StaffBallot =
  | { outcome: 'ready'; name: string; ballot_token: string }
  | { outcome: 'already_voted'; name: string }
  | { outcome: 'not_open' | 'not_checked_out' | 'not_found' };

/** After staff check a guest out: their People's Choice ballot, to open on the organizer's device. No email. */
export async function staffCheckoutBallot(registrationId: string): Promise<StaffBallot | null> {
  const { data, error } = await supabase.rpc('staff_checkout_ballot', { p_registration: registrationId });
  return error ? null : (data as StaffBallot);
}

/** Opened by script (not a plain link) so the ballot tab may close itself after the vote. */
export function openKioskVote(ballotToken: string) {
  window.open(publicUrl(`vote/${ballotToken}?kiosk=1`), '_blank');
}
