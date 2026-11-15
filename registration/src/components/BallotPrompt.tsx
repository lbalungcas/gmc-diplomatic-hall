import { Link } from 'react-router-dom';
import type { CheckoutBallot } from '../lib/checkoutBallot';

/** People's Choice: shown after checking out while voting is open. */
export function BallotPrompt({ ballot }: { ballot: CheckoutBallot }) {
  if (ballot.outcome === 'already_voted') {
    return <p className="mt-4 text-center text-sm text-slate-600">Thanks for voting for the People's Choice of Innovation!</p>;
  }
  if (!ballot.ballot_token) return null;
  const emailed = ballot.outcome === 'sent' || ballot.outcome === 'skipped' || ballot.outcome === 'already_sent';
  return (
    <section className="card mt-4 overflow-hidden text-center">
      <div className="h-1 bg-sun" aria-hidden="true" />
      <div className="space-y-3 p-6">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">Before you go</p>
        <h2 className="text-xl font-extrabold text-navy">Vote for the People's Choice of Innovation</h2>
        <p className="text-sm text-slate-700">Which booth impressed you most? It takes less than a minute.</p>
        <Link to={`/vote/${ballot.ballot_token}`} className="btn-sun w-full justify-center py-3 text-base">Vote for a booth</Link>
        {emailed && <p className="text-xs text-slate-500">We've also emailed you this link, so you can vote later.</p>}
      </div>
    </section>
  );
}
