import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { formatTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Status } from '../../lib/types';
import { useEvent } from '../../lib/useEvent';

interface Hit {
  id: string;
  full_name: string;
  preferred_name: string | null;
  organization: string | null;
  category: string | null;
  status: Status;
  photo_consent: boolean;
  checked_in_at: string | null;
}

/** For guests without their phone: find by name or organization and check in by hand. */
export default function CheckIn() {
  const { event } = useEvent();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!event || q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_checkin', { p_event: event.id, p_q: q });
      setHits((data ?? []) as Hit[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, event, version]);

  async function checkIn(h: Hit) {
    const { data, error } = await supabase.rpc('check_in_manual', { p_id: h.id });
    if (error) setMessage({ tone: 'warn', text: error.message });
    else if (data.result === 'checked_in') setMessage({ tone: 'ok', text: `${h.full_name} checked in.${h.photo_consent ? '' : ' NO PHOTOS for this guest.'}` });
    else if (data.result === 'already_checked_in') setMessage({ tone: 'warn', text: `${h.full_name} was already checked in at ${formatTime(data.checked_in_at)}.` });
    else setMessage({ tone: 'warn', text: `${h.full_name} is not approved (${data.status}). Do not admit — refer to an admin.` });
    setVersion((v) => v + 1);
  }

  async function undo(h: Hit) {
    if (!window.confirm(`Undo check-in for ${h.full_name}?`)) return;
    const { error } = await supabase.rpc('undo_check_in', { p_id: h.id });
    setMessage(error ? { tone: 'warn', text: error.message } : { tone: 'ok', text: `Check-in undone for ${h.full_name}.` });
    setVersion((v) => v + 1);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Manual check-in</h1>
        <Link to="/admin/scan" className="btn-primary">Open scanner</Link>
      </div>
      <label htmlFor="q" className="sr-only">Search by name or organization</label>
      <input id="q" type="search" autoFocus className="input py-3 text-lg" placeholder="Search by name or organization" value={q} onChange={(e) => setQ(e.target.value)} />
      {message && (
        <p role="status" className={`rounded-lg px-4 py-3 font-semibold ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
          {message.text}
        </p>
      )}
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-slate-900">
                {h.full_name}
                {h.preferred_name && h.preferred_name !== h.full_name && <span className="font-normal text-slate-500"> “{h.preferred_name}”</span>}
              </div>
              <div className="text-sm text-slate-600">{[h.organization, h.category].filter(Boolean).join(' · ')}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={h.status} checkedIn={!!h.checked_in_at} />
                {h.checked_in_at && <span className="text-slate-500">at {formatTime(h.checked_in_at)}</span>}
                {!h.photo_consent && <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">NO PHOTOS</span>}
              </div>
            </div>
            {h.checked_in_at ? (
              <button className="btn-ghost" onClick={() => undo(h)}>Undo</button>
            ) : h.status === 'approved' ? (
              <button className="btn-primary px-6 py-3 text-base" onClick={() => checkIn(h)}>Check in</button>
            ) : (
              <span className="text-sm font-semibold text-red-700">Not approved</span>
            )}
          </li>
        ))}
      </ul>
      {q.trim().length >= 2 && !searching && hits.length === 0 && <p className="text-center text-slate-500">No one found.</p>}
    </div>
  );
}
