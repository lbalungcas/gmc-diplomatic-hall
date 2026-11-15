import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';
import { NOTE_MAX } from '../lib/constants';
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

function Candidate({ c, kind, selected, onSelect }: { c: BallotCandidate; kind: Ballot['award']['kind']; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${
        selected ? 'border-navy bg-navy-surface' : 'border-slate-200 bg-white hover:border-navy/40'
      }`}
    >
      <input type="radio" name="candidate" value={c.id} checked={selected} onChange={onSelect} className="mt-1 size-5 accent-navy" />
      {kind === 'peoples_choice' && c.booth_no != null && (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sun font-display text-lg font-bold text-navy">{c.booth_no}</span>
      )}
      <span className="min-w-0">
        <span className="block font-semibold text-navy">{c.label}</span>
        {(c.team || c.track) && (
          <span className="block text-sm text-slate-600">{[kind === 'mpyi' ? c.team : null, c.track].filter(Boolean).join(' · ')}</span>
        )}
      </span>
    </label>
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
  const [ballot, setBallot] = useState<Ballot | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
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

  const filtered = useMemo(() => {
    if (!ballot) return [];
    const term = search.trim().toLowerCase();
    if (!term) return ballot.candidates;
    return ballot.candidates.filter((c) =>
      [c.label, c.team, c.track, c.booth_no?.toString()].some((v) => v?.toLowerCase().includes(term)),
    );
  }, [ballot, search]);

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
    // Most Promising: name/team/track come from the roster on the server; the form only sends the pick.
    const { data, error: rpcError } = await supabase.rpc('cast_vote', {
      p_token: token,
      p_candidate: choice,
      p_name: mpyi ? null : name,
      p_team: null,
      p_track: null,
      p_note: note,
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
      <article className="card overflow-hidden">
        <div className="bg-navy px-6 py-5 text-white">
          <p className="text-xs font-semibold tracking-widest text-sun uppercase">{ballot.event.name} · Awards</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">{ballot.award.title}</h1>
          <p className="mt-1 text-sm text-white/80">
            {mpyi
              ? 'Vote for the fellow youth innovator you think is the most promising. You can vote once, and not for yourself.'
              : 'Vote for the booth you think deserves the People\'s Choice award. One vote per person.'}
          </p>
        </div>
        <div className="h-1 bg-sun" aria-hidden="true" />

        <form onSubmit={submit} className="space-y-6 p-6">
          {!mpyi && (
            <fieldset className="space-y-4">
              <legend className="mb-1 text-lg font-bold text-navy">About you</legend>
              <div>
                <label htmlFor="v-name" className="label">Your name</label>
                <input id="v-name" className="input" required maxLength={300} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-2 text-lg font-bold text-navy">{mpyi ? 'Who gets your vote?' : 'Which booth gets your vote?'}</legend>
            {mpyi ? (
              <DelegatePicker candidates={ballot.candidates} value={choice} onChange={setChoice} />
            ) : (
              <>
                {ballot.candidates.length > 8 && (
                  <input
                    type="search"
                    className="input mb-3"
                    placeholder="Search by booth number or name"
                    aria-label="Search the ballot"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {filtered.map((c) => (
                    <Candidate key={c.id} c={c} kind={ballot.award.kind} selected={choice === c.id} onSelect={() => setChoice(c.id)} />
                  ))}
                </div>
                {filtered.length === 0 && <p className="text-sm text-slate-500">No match. Try a different search.</p>}
              </>
            )}
          </fieldset>

          <div>
            <label htmlFor="v-note" className="label">{mpyi ? 'Why did you pick them?' : 'Why this booth?'} <span className="font-normal text-slate-500">(optional)</span></label>
            <textarea id="v-note" className="input min-h-24" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="mt-1 text-right text-xs text-slate-500">{note.length} / {NOTE_MAX}</p>
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

          <button type="submit" className="btn-primary w-full py-3 text-base" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit my vote'}
          </button>
          <p className="text-center text-xs text-slate-500">Your vote is final once submitted. Questions? Write to {contact}.</p>
        </form>
      </article>
    </PublicShell>
  );
}
