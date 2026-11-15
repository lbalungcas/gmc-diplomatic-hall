import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { BallotPrompt } from '../components/BallotPrompt';
import { PublicShell } from '../components/PublicShell';
import { guestCheckoutBallot, type CheckoutBallot } from '../lib/checkoutBallot';
import { formatTime } from '../lib/format';
import { ticketTokenFrom } from '../lib/paths';
import { clearCheckoutCode, forgetTicket, rememberCheckoutCode, savedTickets, type SavedTicket } from '../lib/savedTickets';
import { supabase } from '../lib/supabase';
import type { CheckoutStation, SelfCheckOutResult } from '../lib/types';

type Shown = SelfCheckOutResult | { result: 'network_error' };

/** Opened by scanning the check-out poster at the exit. */
export default function Checkout() {
  const { code = '' } = useParams();
  const [station, setStation] = useState<CheckoutStation | null | undefined>(undefined);
  const [tickets, setTickets] = useState<SavedTicket[]>(() => savedTickets());
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [ballot, setBallot] = useState<CheckoutBallot | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('get_checkout_station', { p_code: code }).then(({ data, error }) => {
      const s = error ? null : (data as CheckoutStation | null);
      setStation(s);
      // If the guest goes to their email to open the ticket, the ticket page offers "Check out now".
      if (s) rememberCheckoutCode(code);
    });
  }, [code]);

  async function checkOut(token: string) {
    setBusy(token);
    try {
      const { data, error } = await supabase.rpc('self_check_out', { p_token: token, p_code: code });
      if (error) throw error;
      const r = data as SelfCheckOutResult;
      if (r.result === 'invalid') {
        forgetTicket(token);
        setTickets(savedTickets());
      }
      setBallot(null);
      if (r.result === 'checked_out' || r.result === 'already_checked_out') {
        clearCheckoutCode();
        setBallot(await guestCheckoutBallot(token));
      }
      setShown(r);
    } catch {
      setShown({ result: 'network_error' });
    } finally {
      setBusy(null);
    }
  }

  function onLink(e: FormEvent) {
    e.preventDefault();
    const token = ticketTokenFrom(link);
    if (!token) {
      setLinkError("That doesn't look like a ticket link. It's the link in your confirmation email.");
      return;
    }
    setLinkError(null);
    checkOut(token);
  }

  if (station === undefined) {
    return <PublicShell><p className="py-20 text-center text-slate-500">Loading…</p></PublicShell>;
  }

  if (station === null) {
    return (
      <PublicShell>
        <div className="card p-6 text-center">
          <h1 className="text-2xl font-bold">This check-out code isn't valid</h1>
          <p className="mt-2">Please scan the check-out QR code at the exit again, or ask the registration desk to check you out.</p>
        </div>
      </PublicShell>
    );
  }

  const tz = station.event.timezone;

  if (shown) {
    return (
      <PublicShell>
        <ResultCard r={shown} tz={tz} contact={station.event.contact_email} onBack={() => setShown(null)} />
        {ballot && <BallotPrompt ballot={ballot} />}
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <article className="card overflow-hidden">
        <div className="bg-navy px-6 py-5 text-white">
          <p className="text-xs font-semibold tracking-widest text-sun uppercase">{station.event.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">Check out</h1>
          <p className="mt-1 text-sm text-white/80">Leaving the venue? Check out so we know you've left safely.</p>
        </div>
        <div className="h-1 bg-sun" aria-hidden="true" />

        <div className="space-y-6 p-6">
          {tickets.length > 0 ? (
            <div className="space-y-3">
              <h2 className="font-bold text-navy">{tickets.length === 1 ? 'Is this you?' : 'Who is checking out?'}</h2>
              {tickets.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  className="btn-primary w-full justify-center py-4 text-lg"
                  disabled={busy !== null}
                  onClick={() => checkOut(t.token)}
                >
                  {busy === t.token ? 'Checking out…' : `Check out ${t.name}`}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-sun-light p-4 text-slate-800">
              <p className="font-bold">Open your ticket first</p>
              <p className="mt-1 text-sm">
                Open the ticket link from your confirmation email on this phone. Your ticket will show a <strong>Check out now</strong> button.
              </p>
            </div>
          )}

          <form onSubmit={onLink} className="space-y-2 border-t border-slate-200 pt-5">
            <label htmlFor="ticket-link" className="block text-sm font-semibold text-navy">
              {tickets.length > 0 ? 'Someone else? Paste their ticket link' : 'Or paste your ticket link'}
            </label>
            <div className="flex gap-2">
              <input
                id="ticket-link"
                className="input min-w-0 flex-1"
                placeholder="https://…/register/t/…"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <button className="btn-ghost" disabled={busy !== null || !link.trim()}>Check out</button>
            </div>
            {linkError && <p className="text-sm text-red-700">{linkError}</p>}
          </form>

          <p className="text-sm text-slate-500">
            No phone or no ticket? The registration desk can check you out.
          </p>
        </div>
      </article>
    </PublicShell>
  );
}

function ResultCard({ r, tz, contact, onBack }: { r: Shown; tz: string; contact: string; onBack: () => void }) {
  const name = 'full_name' in r ? r.preferred_name || r.full_name : null;
  const out = 'checked_out_at' in r ? r.checked_out_at : null;
  const content = {
    checked_out: { tone: 'border-emerald-300 bg-emerald-50 text-emerald-950', title: "You're checked out ✓", body: `Thanks for coming${name ? `, ${name}` : ''}! Checked out at ${formatTime(out, tz)}. Have a safe trip home.` },
    already_checked_out: { tone: 'border-emerald-300 bg-emerald-50 text-emerald-950', title: 'Already checked out', body: `${name ? `${name}, you` : 'You'} checked out at ${formatTime(out, tz)}. Nothing else to do.` },
    not_checked_in: { tone: 'border-amber-300 bg-amber-50 text-amber-950', title: "You haven't checked in", body: 'This ticket was never checked in, so there is nothing to check out. If you did attend, please tell the registration desk.' },
    not_approved: { tone: 'border-amber-300 bg-amber-50 text-amber-950', title: 'This ticket is not confirmed', body: 'Please see the registration desk.' },
    invalid: { tone: 'border-red-300 bg-red-50 text-red-950', title: "We couldn't find this ticket", body: 'Use the link from your most recent confirmation email, or ask the registration desk.' },
    wrong_station: { tone: 'border-red-300 bg-red-50 text-red-950', title: 'This check-out code is out of date', body: 'Please scan the check-out QR code at the exit again.' },
    network_error: { tone: 'border-slate-300 bg-slate-50 text-slate-900', title: 'No connection', body: 'Check your signal and try again.' },
  }[r.result];
  const done = r.result === 'checked_out' || r.result === 'already_checked_out';

  return (
    <div role="status" className={`rounded-2xl border p-6 text-center ${content.tone}`}>
      <h1 className="text-2xl font-extrabold">{content.title}</h1>
      <p className="mt-2">{content.body}</p>
      {!done && (
        <>
          <button type="button" className="btn-primary mt-5" onClick={onBack}>Try again</button>
          <p className="mt-4 text-sm">Questions? <a className="font-semibold underline" href={`mailto:${contact}`}>{contact}</a></p>
        </>
      )}
    </div>
  );
}
