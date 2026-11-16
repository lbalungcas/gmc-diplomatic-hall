import { openKioskVote, type StaffBallot } from '../lib/checkoutBallot';

/**
 * Exit table: after staff check a guest out, a button opens that guest's People's Choice ballot
 * in a new tab so they vote before leaving. A button (not an automatic pop-up) because browsers
 * block tabs opened without a tap, e.g. right after a camera scan.
 */
export function KioskVotePrompt({ ballot, dark = false, onDone }: { ballot: StaffBallot | null; dark?: boolean; onDone: () => void }) {
  if (ballot && (ballot.outcome === 'not_checked_out' || ballot.outcome === 'not_found')) return null;
  const muted = dark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-800';

  if (!ballot || ballot.outcome !== 'ready') {
    const text = !ballot
      ? "Couldn't load the People's Choice vote. Check the connection."
      : ballot.outcome === 'already_voted'
        ? `${ballot.name} already voted for People's Choice.`
        : "People's Choice voting isn't open, so there's no vote to open.";
    return (
      <div role="status" className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${muted}`}>
        <span className="flex-1">{text}</span>
        <button type="button" className="text-xs underline opacity-80" onClick={onDone}>Dismiss</button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="btn-sun w-full justify-center py-4 text-lg"
        onClick={() => {
          openKioskVote(ballot.ballot_token);
          onDone();
        }}
      >
        Open vote for {ballot.name}
      </button>
      <p className={`text-center text-xs ${dark ? 'text-white/60' : 'text-slate-500'}`}>
        Opens their People's Choice booth map in a new tab. Hand them the device to tap a booth.{' '}
        <button type="button" className="underline" onClick={onDone}>Skip</button>
      </p>
    </div>
  );
}
