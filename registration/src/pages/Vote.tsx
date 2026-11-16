import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';
import { NOTE_MAX } from '../lib/constants';
import { FLOOR_ISLANDS } from '../lib/floorPlan';
import { supabase } from '../lib/supabase';
import type { Ballot, BallotCandidate, CastVoteResult } from '../lib/types';

function Message({ title, children, tone = 'navy' }: { title: string; children: ReactNode; tone?: 'navy' | 'ok' | 'muted' }) {
  const ring = tone === 'ok' ? 'border-emerald-300 bg-emerald-50' : tone === 'muted' ? 'border-slate-300 bg-slate-50' : 'border-navy/20 bg-navy-surface';
  return (
    <div className={`card border p-6 text-center ${ring}`}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-2 text-slate-700">{children}</div>
    </div>
  );
}

function BoothSquare({ c, no, color, selected, onSelect }: { c?: BallotCandidate; no: number; color: string; selected: boolean; onSelect: (id: string) => void }) {
  if (!c) {
    return (
      <span className="grid aspect-square place-items-center rounded-md border border-dashed border-slate-300 text-xs text-slate-300" aria-hidden="true">
        {no}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Booth ${no}: ${c.label}`}
      onClick={() => onSelect(c.id)}
      style={selected ? undefined : { borderColor: color, backgroundColor: `${color}26` }}
      className={`grid aspect-square place-items-center rounded-md border-2 font-display text-base font-extrabold transition sm:text-lg ${
        selected ? 'scale-105 border-navy bg-navy text-white shadow-lg ring-2 ring-sun' : 'text-navy hover:brightness-95 active:scale-95'
      }`}
    >
      {no}
    </button>
  );
}

/** People's Choice: the 24 booths drawn as they stand in the hall. Tap a square to pick it. */
function BoothMap({ candidates, value, onChange }: { candidates: BallotCandidate[]; value: string; onChange: (id: string) => void }) {
  const byBooth = new Map(candidates.filter((c) => c.booth_no != null).map((c) => [c.booth_no!, c]));
  const onMap = new Set(FLOOR_ISLANDS.flatMap((i) => i.rows.flatMap((r) => r.booths)));
  const extras = candidates.filter((c) => c.booth_no == null || !onMap.has(c.booth_no));
  const selected = candidates.find((c) => c.id === value);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="mx-auto mb-3 w-2/3 rounded-md bg-navy py-1.5 text-center text-xs font-bold tracking-widest text-sun uppercase">Stage</div>
        {FLOOR_ISLANDS.map((island, i) => (
          <div key={island.name}>
            {i > 0 && <p className="py-2 text-center text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Alley</p>}
            <div role="group" aria-label={island.name} className="space-y-1">
              {island.rows.map((row, j) => (
                <div key={row.row}>
                  {j === 1 && <div className="mx-1 mb-1 h-1 rounded-full bg-navy/70" aria-hidden="true" />}
                  <div className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-center gap-1.5">
                    <span className="w-4 text-center text-[10px] font-bold text-slate-400">{row.row}</span>
                    {row.booths.map((no) => (
                      <BoothSquare key={no} no={no} c={byBooth.get(no)} color={row.color} selected={byBooth.get(no)?.id === value} onSelect={onChange} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {extras.length > 0 && (
          <div className="mt-3 border-t border-slate-200 pt-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-500">More booths</p>
            <div className="grid grid-cols-6 gap-1.5">
              {extras.map((c) => (
                <BoothSquare key={c.id} no={c.booth_no ?? 0} c={c} color="#94a3b8" selected={c.id === value} onSelect={onChange} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite" className={`rounded-xl border-2 p-4 ${selected ? 'border-navy bg-navy-surface' : 'border-dashed border-slate-300 text-center text-sm text-slate-500'}`}>
        {selected ? (
          <>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Booth {selected.booth_no}</p>
            <p className="text-lg font-extrabold text-navy">{selected.label}</p>
            {selected.track && <p className="text-sm text-slate-600">{selected.track}</p>}
          </>
        ) : (
          'Tap a booth on the map to choose it.'
        )}
      </div>
    </div>
  );
}

const AUTOFILL = [
  ['team', 'Team'],
  ['innovation', 'Innovation name'],
  ['country', 'Country'],
  ['gender', 'Gender'],
] as const;

/** Most Promising: choose a name from the list; their details fill in below. */
function DelegatePicker({ candidates, value, onChange }: { candidates: BallotCandidate[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const selected = candidates.find((c) => c.id === value);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={id} className="label">Name of the innovator you are voting for</label>
        <select id={id} className="input" required value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a name…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2" aria-live="polite">
        {AUTOFILL.map(([key, label]) => (
          <div key={key}>
            <label htmlFor={`${id}-${key}`} className="label">{label}</label>
            <input
              id={`${id}-${key}`}
              className="input cursor-default bg-slate-50 text-slate-900"
              readOnly
              tabIndex={-1}
              value={selected?.[key] ?? ''}
              placeholder={selected ? 'Not provided' : 'Fills in when you pick a name'}
            />
          </div>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-slate-600">Check these details. If this is not the person you meant, change the name above.</p>
      )}
    </div>
  );
}

export default function Vote() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const fromCheckout = params.get('from') === 'checkout';
  const [ballot, setBallot] = useState<Ballot | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ choice: string } | null>(null);

  useEffect(() => {
    supabase.rpc('get_ballot', { p_token: token }).then(({ data, error: e }) => {
      const b = e ? null : (data as Ballot | null);
      setBallot(b);
      if (b && b.award.kind !== 'mpyi') setName(b.voter.name ?? '');
    });
  }, [token]);

  if (ballot === undefined) {
    return <PublicShell><p className="py-20 text-center text-slate-500">Loading your ballot…</p></PublicShell>;
  }
  if (ballot === null) {
    return (
      <PublicShell>
        <Message title="Ballot not found" tone="muted">
          <p>This voting link is invalid. Please use the link from your ballot email.</p>
        </Message>
      </PublicShell>
    );
  }

  const mpyi = ballot.award.kind === 'mpyi';
  const askName = !mpyi && !ballot.voter.name;
  const picked = ballot.candidates.find((c) => c.id === choice);
  const contact = <a className="font-semibold text-navy underline" href={`mailto:${ballot.event.contact_email}`}>{ballot.event.contact_email}</a>;

  if (done || ballot.voted_at) {
    return (
      <PublicShell>
        <Message title={done ? 'Thank you for voting!' : 'You already voted'} tone="ok">
          <p>
            Your vote for <strong>{ballot.award.title}</strong>
            {(done?.choice ?? ballot.choice) && <> went to <strong>{done?.choice ?? ballot.choice}</strong></>}. Each person can vote once.
          </p>
          <p className="mt-2 text-sm">The winner will be announced at the {ballot.event.name}.</p>
        </Message>
        <div className="mt-4 text-center">
          <Link to="/" className="btn-primary w-full justify-center py-3 text-base">Back to registration home</Link>
        </div>
      </PublicShell>
    );
  }

  if (!ballot.award.open) {
    return (
      <PublicShell>
        <Message title="Voting is closed" tone="muted">
          <p>Voting for <strong>{ballot.award.title}</strong> isn't open right now. Questions? Write to {contact}.</p>
        </Message>
      </PublicShell>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!choice) {
      setError(mpyi ? 'Please choose the innovator you are voting for.' : 'Please choose a booth.');
      return;
    }
    setBusy(true);
    // The voter's name, team and track come from their voter row on the server unless the form asks for a name.
    const { data, error: rpcError } = await supabase.rpc('cast_vote', {
      p_token: token,
      p_candidate: choice,
      p_name: askName ? name : null,
      p_team: null,
      p_track: null,
      p_note: mpyi ? note : null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || 'Something went wrong. Please try again.');
      return;
    }
    const res = data as CastVoteResult;
    if (res.result === 'voted') setDone({ choice: res.choice });
    else if (res.result === 'already_voted') setBallot({ ...ballot!, voted_at: res.voted_at });
    else if (res.result === 'closed') setBallot({ ...ballot!, award: { ...ballot!.award, open: false } });
    else setBallot(null);
  }

  return (
    <PublicShell>
      {fromCheckout && (
        <div role="status" className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center text-emerald-950">
          <p className="text-lg font-extrabold">You're checked out ✓</p>
          <p className="text-sm">Thanks for coming! Before you go, tap the booth you liked most.</p>
        </div>
      )}
      <article className="card overflow-hidden">
        <div className="bg-navy px-6 py-5 text-white">
          <p className="text-xs font-semibold tracking-widest text-sun uppercase">{ballot.event.name} · Awards</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">{ballot.award.title}</h1>
          <p className="mt-1 text-sm text-white/80">
            {mpyi
              ? 'Vote for the fellow youth innovator you think is the most promising. You can vote once, and not for yourself.'
              : 'Tap the booth you liked most, then press Vote. One vote per person.'}
          </p>
        </div>
        <div className="h-1 bg-sun" aria-hidden="true" />

        <form onSubmit={submit} className="space-y-6 p-6">
          {!mpyi && ballot.voter.name && (
            <p className="rounded-xl bg-navy-surface px-4 py-3 text-sm text-slate-700">
              Voting as <strong className="text-navy">{ballot.voter.name}</strong>
            </p>
          )}

          {askName && (
            <div>
              <label htmlFor="v-name" className="label">Your name</label>
              <input id="v-name" className="input" required maxLength={300} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}

          <fieldset>
            <legend className="mb-2 text-lg font-bold text-navy">{mpyi ? 'Who gets your vote?' : 'Which booth gets your vote?'}</legend>
            {mpyi ? (
              <DelegatePicker candidates={ballot.candidates} value={choice} onChange={setChoice} />
            ) : (
              <BoothMap candidates={ballot.candidates} value={choice} onChange={setChoice} />
            )}
          </fieldset>

          {mpyi && (
            <div>
              <label htmlFor="v-note" className="label">Why did you pick them? <span className="font-normal text-slate-500">(optional)</span></label>
              <textarea id="v-note" className="input min-h-24" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
              <p className="mt-1 text-right text-xs text-slate-500">{note.length} / {NOTE_MAX}</p>
            </div>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

          <button type="submit" className="btn-primary w-full py-3 text-base" disabled={busy}>
            {busy ? 'Submitting…' : !mpyi && picked ? `Vote for Booth ${picked.booth_no}` : 'Submit my vote'}
          </button>
          <p className="text-center text-xs text-slate-500">Your vote is final once submitted. Questions? Write to {contact}.</p>
        </form>
      </article>
    </PublicShell>
  );
}
