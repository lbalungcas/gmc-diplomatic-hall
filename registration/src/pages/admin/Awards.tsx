import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { AWARD_LABEL, describeSend, parseRoster, sendBallots, votesToCsv, type RosterRow } from '../../lib/awards';
import { downloadFile } from '../../lib/csv';
import { formatDateTime, formatTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Award, AwardCandidate, AwardStats, AwardVote, AwardVoter } from '../../lib/types';
import { useEvent } from '../../lib/useEvent';

const ORDER: Award['kind'][] = ['mpyi', 'peoples_choice'];
const POLL_MS = 15000;

type Notice = { tone: 'ok' | 'error'; text: string } | null;
type VoterFilter = '' | 'not_sent' | 'waiting' | 'voted';

/** Every row of a table for one award, past PostgREST's 1000-row page. */
async function fetchAll<T>(table: string, awardId: string, order: string, ascending: boolean): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq('award_id', awardId)
      .order(order, { ascending }).order('id').range(from, from + 999);
    if (error) throw error;
    all.push(...(data as T[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function Awards() {
  const { event } = useEvent();
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAwards = useCallback(async () => {
    if (!event) return;
    const { data, error: e } = await supabase.from('awards').select('*').eq('event_id', event.id);
    if (e) {
      setError(e.message);
      return;
    }
    setAwards((data as Award[]).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)));
  }, [event]);

  useEffect(() => {
    loadAwards();
  }, [loadAwards]);

  if (error) return <p className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">Could not load the awards: {error}. Has the awards migration been applied?</p>;
  if (!event || !awards) return <p className="text-slate-500">Loading…</p>;
  if (awards.length === 0) return <p className="text-slate-500">No awards set up for this event. Run the awards migration and seed.sql.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Awards</h1>
        <p className="text-sm text-slate-600">
          Both ballots update live. Only people on each list get a personal ballot link, and each link counts once.
        </p>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {awards.map((a) => <AwardPanel key={a.id} award={a} timeZone={event.timezone} onAwardChanged={loadAwards} />)}
      </div>
    </div>
  );
}

function AwardPanel({ award, timeZone, onAwardChanged }: { award: Award; timeZone: string; onAwardChanged: () => void }) {
  const mpyi = award.kind === 'mpyi';
  const [stats, setStats] = useState<AwardStats | null>(null);
  const [voters, setVoters] = useState<AwardVoter[]>([]);
  const [votes, setVotes] = useState<AwardVote[]>([]);
  const [candidates, setCandidates] = useState<AwardCandidate[]>([]);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<VoterFilter>('');
  const [closesAt, setClosesAt] = useState(toLocalInput(award.closes_at));

  useEffect(() => setClosesAt(toLocalInput(award.closes_at)), [award.closes_at]);

  const load = useCallback(async () => {
    try {
      const [s, vs, vt, cs] = await Promise.all([
        supabase.rpc('award_stats', { p_award: award.id }).then(({ data, error }) => {
          if (error) throw error;
          return data as AwardStats;
        }),
        fetchAll<AwardVoter>('award_voters', award.id, 'created_at', true),
        fetchAll<AwardVote>('award_votes', award.id, 'created_at', false),
        fetchAll<AwardCandidate>('award_candidates', award.id, 'sort', true),
      ]);
      setStats(s);
      setVoters(vs);
      setVotes(vt);
      setCandidates(cs);
      setUpdatedAt(new Date());
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    }
  }, [award.id]);

  // A bulk sync or send changes hundreds of rows at once; coalesce the change feed into one reload.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      load();
    }, 800);
  }, [load]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`award-${award.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'award_votes', filter: `award_id=eq.${award.id}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'award_voters', filter: `award_id=eq.${award.id}` }, scheduleReload)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    const poll = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => {
      clearInterval(poll);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      supabase.removeChannel(channel);
    };
  }, [award.id, load, scheduleReload]);

  const candidateById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const choiceLabel = (id: string) => {
    const c = candidateById.get(id);
    if (!c) return '—';
    return !mpyi && c.booth_no != null ? `Booth ${c.booth_no} · ${c.label}` : c.label;
  };

  const counts = useMemo(() => ({
    notSent: voters.filter((v) => !v.sent_at && !v.voted_at).length,
    waiting: voters.filter((v) => v.sent_at && !v.voted_at).length,
  }), [voters]);

  const shownVoters = useMemo(() => {
    const term = search.trim().toLowerCase();
    return voters.filter((v) => {
      if (filter === 'not_sent' && (v.sent_at || v.voted_at)) return false;
      if (filter === 'waiting' && (!v.sent_at || v.voted_at)) return false;
      if (filter === 'voted' && !v.voted_at) return false;
      return !term || [v.name, v.email, v.team, v.track].some((x) => x?.toLowerCase().includes(term));
    });
  }, [voters, search, filter]);

  async function run(label: string, fn: () => Promise<string>) {
    setNotice(null);
    setBusy(label);
    try {
      setNotice({ tone: 'ok', text: await fn() });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
      load();
    }
  }

  async function setOpen(open: boolean) {
    const verb = open ? 'Open' : 'Close';
    if (!window.confirm(`${verb} voting for ${award.title}?${open ? '' : '\n\nBallot links will say voting is closed.'}`)) return;
    await run(`${verb === 'Open' ? 'Opening' : 'Closing'}…`, async () => {
      const { error } = await supabase.from('awards').update({ is_open: open }).eq('id', award.id);
      if (error) throw error;
      onAwardChanged();
      return open ? 'Voting is open.' : 'Voting is closed.';
    });
  }

  async function saveClosesAt() {
    const value = closesAt ? new Date(closesAt).toISOString() : null;
    if (value === award.closes_at) return;
    await run('Saving…', async () => {
      const { error } = await supabase.from('awards').update({ closes_at: value }).eq('id', award.id);
      if (error) throw error;
      onAwardChanged();
      return value ? `Voting closes automatically at ${formatDateTime(value, timeZone)}.` : 'No automatic closing time.';
    });
  }

  async function syncVoters() {
    await run('Adding approved registrants…', async () => {
      const { data, error } = await supabase.rpc('sync_pc_voters', { p_award: award.id });
      if (error) throw error;
      const r = data as { added: number; total: number };
      return `${r.added} new voter(s) added from approved registrants · ${r.total} in total.`;
    });
  }

  async function send(reminder: boolean, ids?: string[]) {
    const targets = ids ?? voters.filter((v) => !v.voted_at && (reminder ? v.sent_at : !v.sent_at)).map((v) => v.id);
    if (targets.length === 0) {
      setNotice({ tone: 'error', text: reminder ? 'Nobody is waiting for a reminder.' : 'Everyone already has a ballot.' });
      return;
    }
    if (!ids && !window.confirm(`${reminder ? 'Send a reminder to' : 'Email a ballot to'} ${targets.length} voter${targets.length === 1 ? '' : 's'}?`)) return;
    await run(`Sending 0 / ${targets.length}…`, async () => {
      const c = await sendBallots(award.id, targets, {
        reminder,
        force: !!ids,
        onProgress: (d, t) => setBusy(`Sending ${d} / ${t}…`),
      });
      return describeSend(c, reminder);
    });
  }

  function exportCsv() {
    downloadFile(`yim-${mpyi ? 'most-promising' : 'peoples-choice'}-votes-${new Date().toISOString().slice(0, 10)}.csv`,
      votesToCsv(award.kind, votes, voters, candidates));
  }

  const turnout = stats && stats.eligible ? Math.round((stats.voted / stats.eligible) * 100) : 0;
  const tally = (stats?.tally ?? []).filter((t) => !t.hidden || t.votes > 0);
  const top = Math.max(1, ...tally.map((t) => t.votes));

  return (
    <section className="card overflow-hidden" aria-labelledby={`award-${award.id}`}>
      <header className="bg-navy px-5 py-4 text-white">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id={`award-${award.id}`} className="flex-1 text-xl font-bold text-white">{AWARD_LABEL[award.kind]}</h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${live ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/10 text-white/70'}`}
            title={live ? 'Updates as votes come in' : `Refreshing every ${POLL_MS / 1000} s`}>
            <span className={`size-2 rounded-full ${live ? 'animate-pulse bg-emerald-300' : 'bg-white/50'}`} aria-hidden="true" />
            {live ? 'Live' : 'Polling'}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${stats?.open ? 'bg-sun text-navy' : 'bg-white/15 text-white'}`}>
            {stats?.open ? 'Voting open' : 'Voting closed'}
          </span>
        </div>
        <p className="mt-1 text-sm text-white/75">
          {mpyi ? 'Youth innovators vote for a fellow innovator (not themselves).' : 'Approved visitors vote for a booth.'}
          {updatedAt && <> · Updated {formatTime(updatedAt.toISOString(), timeZone)}</>}
        </p>
      </header>
      <div className="h-1 bg-sun" aria-hidden="true" />

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-end gap-2">
          {award.is_open
            ? <button className="btn-danger" onClick={() => setOpen(false)} disabled={!!busy}>Close voting</button>
            : <button className="btn-primary" onClick={() => setOpen(true)} disabled={!!busy}>Open voting</button>}
          <div>
            <label htmlFor={`closes-${award.id}`} className="label">Closes automatically at</label>
            <div className="flex gap-1">
              <input id={`closes-${award.id}`} type="datetime-local" className="input py-1.5" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
              <button className="btn-ghost" onClick={saveClosesAt} disabled={!!busy || closesAt === toLocalInput(award.closes_at)}>Save</button>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Eligible', stats?.eligible ?? '—'],
            ['Ballots sent', stats?.sent ?? '—'],
            ['Votes cast', stats?.voted ?? '—'],
            ['Turnout', stats ? `${turnout}%` : '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-navy-surface p-3">
              <dt className="text-xs font-semibold text-slate-600">{label}</dt>
              <dd className="font-display text-2xl font-bold text-navy">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2">
          {mpyi
            ? <button className="btn-ghost" onClick={() => setShowRoster(true)} disabled={!!busy}>Import roster</button>
            : <button className="btn-ghost" onClick={syncVoters} disabled={!!busy}>Sync approved registrants</button>}
          <button className="btn-sun" onClick={() => send(false)} disabled={!!busy}>Send ballots ({counts.notSent})</button>
          <button className="btn-ghost" onClick={() => send(true)} disabled={!!busy}>Send reminder ({counts.waiting})</button>
          <button className="btn-ghost" onClick={exportCsv} disabled={!!busy || votes.length === 0}>Export CSV</button>
          <button className="btn-ghost" onClick={() => setShowCandidates((v) => !v)}>{showCandidates ? 'Hide' : 'Edit'} {mpyi ? 'innovators' : 'booths'}</button>
        </div>
        {busy && <p role="status" className="text-sm font-semibold text-navy">{busy}</p>}
        {notice && (
          <p role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border p-3 text-sm ${notice.tone === 'error' ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`}>
            {notice.text}
          </p>
        )}

        {showCandidates && <CandidateEditor award={award} candidates={candidates} onChanged={load} />}

        <div>
          <h3 className="mb-2 font-bold text-navy">Leaderboard</h3>
          {tally.length === 0 ? (
            <p className="text-sm text-slate-500">{mpyi ? 'Import the innovator roster to fill the ballot.' : 'No booths on the ballot yet.'}</p>
          ) : (
            <ol className="space-y-1.5">
              {tally.map((t, i) => {
                const tied = t.votes > 0 && (tally[i - 1]?.votes === t.votes || tally[i + 1]?.votes === t.votes);
                return (
                  <li key={t.candidate_id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 text-sm">
                    <span className="text-right font-bold text-slate-500">{i + 1}</span>
                    <div className="relative overflow-hidden rounded-lg bg-slate-100">
                      <div className={`absolute inset-y-0 left-0 ${i === 0 && t.votes > 0 ? 'bg-sun' : 'bg-navy/15'}`}
                        style={{ width: `${(t.votes / top) * 100}%` }} aria-hidden="true" />
                      <div className="relative truncate px-2 py-1.5">
                        <span className="font-semibold text-navy">{!mpyi && t.booth_no != null ? `${t.booth_no}. ` : ''}{t.label}</span>
                        {(mpyi ? t.team : t.track) && <span className="text-slate-600"> · {mpyi ? t.team : t.track}</span>}
                        {t.hidden && <span className="text-slate-500"> (hidden)</span>}
                      </div>
                    </div>
                    <span className="min-w-12 text-right font-bold tabular-nums">
                      {t.votes}{tied && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-900" title="Tied">tie</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-bold text-navy">Latest votes</h3>
          {votes.length === 0 ? <p className="text-sm text-slate-500">No votes yet.</p> : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {votes.slice(0, 50).map((v) => (
                <li key={v.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{v.voter_name}</span>
                    {mpyi && <span className="text-slate-600">{[v.voter_team, v.voter_track].filter(Boolean).join(' · ')}</span>}
                    <span className="ml-auto text-xs text-slate-500">{formatDateTime(v.created_at, timeZone)}</span>
                  </div>
                  <p>voted for <strong className="text-navy">{choiceLabel(v.candidate_id)}</strong></p>
                  {v.note && <p className="mt-0.5 text-slate-700 italic">“{v.note}”</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-bold text-navy">Voters</h3>
          <div className="mb-2 flex flex-wrap gap-2">
            <input type="search" className="input min-w-48 flex-1 py-1.5" placeholder="Search name, email, team" aria-label="Search voters"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input w-auto py-1.5" aria-label="Filter voters" value={filter} onChange={(e) => setFilter(e.target.value as VoterFilter)}>
              <option value="">All ({voters.length})</option>
              <option value="not_sent">Not sent ({counts.notSent})</option>
              <option value="waiting">Sent, not voted ({counts.waiting})</option>
              <option value="voted">Voted ({stats?.voted ?? 0})</option>
            </select>
          </div>
          <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Voter</th>
                  {mpyi && <th scope="col" className="px-3 py-2">Team · track</th>}
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownVoters.slice(0, 200).map((v) => (
                  <tr key={v.id}>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{v.name || '—'}</div>
                      <div className="text-xs break-all text-slate-500">{v.email}</div>
                    </td>
                    {mpyi && <td className="px-3 py-2 text-slate-700">{[v.team, v.track].filter(Boolean).join(' · ') || '—'}</td>}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {v.voted_at
                        ? <span className="font-semibold text-emerald-800">Voted {formatTime(v.voted_at, timeZone)}</span>
                        : v.sent_at ? <span className="text-slate-700">Sent {formatDateTime(v.sent_at, timeZone)}</span>
                        : <span className="text-amber-800">Not sent</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!v.voted_at && (
                        <button className="text-xs font-semibold text-navy underline disabled:opacity-50" disabled={!!busy}
                          onClick={() => send(!!v.sent_at, [v.id])}>
                          {v.sent_at ? 'Resend' : 'Send'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shownVoters.length === 0 && (
              <p className="p-3 text-sm text-slate-500">
                {voters.length === 0 ? (mpyi ? 'Import the innovator roster to add voters.' : 'Press "Sync approved registrants" to add voters.') : 'No voters match.'}
              </p>
            )}
            {shownVoters.length > 200 && <p className="p-3 text-xs text-slate-500">Showing 200 of {shownVoters.length}. Search to narrow it down.</p>}
          </div>
        </div>
      </div>

      {showRoster && <RosterDialog award={award} onClose={() => setShowRoster(false)} onImported={(text) => { setNotice({ tone: 'ok', text }); load(); }} />}
    </section>
  );
}

function RosterDialog({ award, onClose, onImported }: { award: Award; onClose: () => void; onImported: (text: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows: RosterRow[] = useMemo(() => (text.trim() ? parseRoster(text) : []), [text]);
  const missing = rows.filter((r) => !r.name || !r.email || !r.team || !r.track).length;

  async function readFile(file: File | undefined) {
    if (file) setText(await file.text());
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('import_award_voters', { p_award: award.id, p_rows: rows });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    const r = data as { inserted: number; updated: number; errors: { row: number; error: string }[] };
    const bad = r.errors.length ? ` · ${r.errors.length} row(s) skipped (${r.errors.slice(0, 3).map((x) => `row ${x.row}: ${x.error}`).join('; ')})` : '';
    onImported(`Roster imported: ${r.inserted} new, ${r.updated} updated${bad}.`);
    onClose();
  }

  return (
    <Modal title="Import the youth innovator roster" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p>
          A CSV with the columns <strong>Name, Email, Team, Track</strong>. Each innovator gets a ballot and appears on everyone
          else's ballot. Importing again updates existing people instead of adding them twice.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} className="block text-sm" />
        <label htmlFor="roster-text" className="label">…or paste the CSV</label>
        <textarea id="roster-text" className="input min-h-32 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Name,Email,Team,Track\nAna Cruz,ana@example.org,Team A,Online Child Sexual Exploitation and Abuse'} />
        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-200">
            <p className="border-b border-slate-200 px-3 py-2 font-semibold">
              {rows.length} innovator{rows.length === 1 ? '' : 's'} found
              {missing > 0 && <span className="text-amber-800"> · {missing} missing a name, email, team or track</span>}
            </p>
            <div className="max-h-48 overflow-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i}><td className="px-3 py-1">{r.name}</td><td className="px-3 py-1">{r.email}</td><td className="px-3 py-1">{r.team}</td><td className="px-3 py-1">{r.track}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || rows.length === 0}>{busy ? 'Importing…' : `Import ${rows.length}`}</button>
        </div>
      </div>
    </Modal>
  );
}

function CandidateEditor({ award, candidates, onChanged }: { award: Award; candidates: AwardCandidate[]; onChanged: () => void }) {
  const mpyi = award.kind === 'mpyi';
  const [error, setError] = useState<string | null>(null);
  const [newNo, setNewNo] = useState('');
  const [newLabel, setNewLabel] = useState('');

  async function update(id: string, patch: Partial<Pick<AwardCandidate, 'label' | 'team' | 'track' | 'hidden'>>) {
    setError(null);
    const { error: e } = await supabase.from('award_candidates').update(patch).eq('id', id);
    if (e) setError(e.message);
    onChanged();
  }

  async function add() {
    setError(null);
    const booth = Number(newNo);
    const { error: e } = await supabase.from('award_candidates').insert({
      award_id: award.id, label: newLabel.trim(), booth_no: booth, sort: booth,
    });
    if (e) {
      setError(e.message.includes('award_candidates_booth_key') ? `Booth ${booth} is already on the ballot.` : e.message);
      return;
    }
    setNewNo('');
    setNewLabel('');
    onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="mb-2 text-sm text-slate-600">
        {mpyi
          ? 'Innovators come from the roster. Fix a name or team here, or hide someone from the ballot.'
          : 'Rename a booth or hide it from the ballot. Votes already cast are kept.'}
      </p>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            {!mpyi && <span className="w-8 text-right font-bold text-slate-500">{c.booth_no}</span>}
            <input className="input min-w-40 flex-1 py-1" defaultValue={c.label} aria-label="Name on the ballot"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.label && update(c.id, { label: e.target.value.trim() })} />
            {mpyi && (
              <input className="input w-40 py-1" defaultValue={c.team ?? ''} aria-label="Team"
                onBlur={(e) => e.target.value.trim() !== (c.team ?? '') && update(c.id, { team: e.target.value.trim() || null })} />
            )}
            <label className="flex items-center gap-1 text-xs font-semibold text-slate-600">
              <input type="checkbox" className="size-4 accent-navy" checked={c.hidden} onChange={(e) => update(c.id, { hidden: e.target.checked })} />
              Hidden
            </label>
          </li>
        ))}
      </ul>
      {!mpyi && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-2">
          <input className="input w-24 py-1" type="number" min={1} max={999} placeholder="Booth #" aria-label="Booth number" value={newNo} onChange={(e) => setNewNo(e.target.value)} />
          <input className="input min-w-40 flex-1 py-1" placeholder="Booth name" aria-label="Booth name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button className="btn-ghost" onClick={add} disabled={!newNo || !newLabel.trim()}>Add booth</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
