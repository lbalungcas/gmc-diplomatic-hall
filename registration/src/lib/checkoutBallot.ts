import { callFunction } from './supabase';

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

/** After staff check a guest out. Best effort: a failure here must never block the door. */
export function emailCheckoutBallot(registrationId: string) {
  callFunction('checkout-ballot', { registration_id: registrationId }).catch(() => {});
}
