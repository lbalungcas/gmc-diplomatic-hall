import { useCallback, useEffect, useMemo, useState } from 'react';
import { statusLabel, StatusBadge } from '../../components/StatusBadge';
import { STATUSES } from '../../lib/constants';
import { downloadFile, registrationsToCsv } from '../../lib/csv';
import { decide, describeSummary, type Decision } from '../../lib/decide';
import { formatDateTime } from '../../lib/format';
import { plainText, questionFor, questions, resolveForm, type FormSchema } from '../../lib/form';
import { supabase } from '../../lib/supabase';
import type { EventRow, EventStats, Registration, Status } from '../../lib/types';
import { useEvent } from '../../lib/useEvent';
import { DeclineDialog } from './DeclineDialog';
import { ImportDialog } from './ImportDialog';
import { RegistrantDrawer } from './RegistrantDrawer';

const PAGE_SIZE = 50;
type SortKey = 'created_at' | 'full_name' | 'organization' | 'category' | 'status' | 'checked_in_at';

interface Filters {
  search: string;
  status: Status | '';
  category: string;
  country: string;
  checkedIn: '' | 'yes' | 'no';
  /** Filter on any choice question: question id + option label. */
  answerQ: string;
  answerV: string;
}

const EMPTY_FILTERS: Filters = { search: '', status: '', category: '', country: '', checkedIn: '', answerQ: '', answerV: '' };

interface Filterable<T> {
  or: (s: string) => T;
  eq: (c: string, v: string) => T;
  not: (c: string, op: string, v: null) => T;
  is: (c: string, v: null) => T;
  contains: (c: string, v: Record<string, unknown>) => T;
}

function applyFilters<T extends Filterable<T>>(q: T, f: Filters, form: FormSchema): T {
  // PostgREST filter syntax treats , ( ) as separators — strip them from free text.
  const term = f.search.trim().replace(/[,()*%\\:]/g, ' ').trim();
  if (term) q = q.or(`full_name.ilike.*${term}*,preferred_name.ilike.*${term}*,email.ilike.*${term}*,organization.ilike.*${term}*`);
  if (f.status) q = q.eq('status', f.status);
  if (f.category) q = q.eq('category', f.category);
  if (f.country) q = q.eq('country', f.country);
  if (f.checkedIn === 'yes') q = q.not('checked_in_at', 'is', null);
  if (f.checkedIn === 'no') q = q.is('checked_in_at', null);
  const aq = questions(form).find((x) => x.id === f.answerQ);
  if (aq && f.answerV) {
    q = aq.kind === 'checkbox' ? q.contains('answers', { [aq.id]: [f.answerV] }) : q.eq(`answers->>${aq.id}`, f.answerV);
  }
  return q;
}

export default function Dashboard() {
  const { event } = useEvent();
  const form = useMemo(() => resolveForm(event?.form_schema), [event]);
  const choiceQuestions = useMemo(() => questions(form).filter((q) => q.kind === 'radio' || q.kind === 'checkbox'), [form]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [rows, setRows] = useState<Registration[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'created_at', asc: false });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [declineFor, setDeclineFor] = useState<string[] | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadStats = useCallback(async () => {
    if (!event) return;
    const { data } = await supabase.rpc('event_stats', { p_event: event.id });
    setStats(data as EventStats);
  }, [event]);

  const loadRows = useCallback(async () => {
    if (!event) return;
    let q = supabase
      .from('registrations')
      .select('*', { count: 'exact' })
      .eq('event_id', event.id)
      .is('anonymized_at', null);
    q = applyFilters(q, filters, form);
    const { data, count: total, error } = await q
      .order(sort.key, { ascending: sort.asc, nullsFirst: false })
      .order('id')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) {
      setNotice({ tone: 'error', text: error.message });
      return;
    }
    setRows(data as Registration[]);
    setCount(total ?? 0);
  }, [event, filters, sort, page, form]);

  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1); // tells an open drawer to reload too
    return Promise.all([loadStats(), loadRows()]);
  }, [loadStats, loadRows]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // "Live" stats: poll while the tab is open (cheap: one aggregate query).
  useEffect(() => {
    loadStats();
    const t = setInterval(() => document.visibilityState === 'visible' && loadStats(), 15000);
    return () => clearInterval(t);
  }, [loadStats]);

  useEffect(() => {
    if (!event) return;
    supabase.from('registrations').select('country, category').eq('event_id', event.id).then(({ data }) => {
      const rowsData = (data ?? []) as { country: string | null; category: string | null }[];
      setCountries([...new Set(rowsData.map((r) => r.country).filter((c): c is string => !!c))].sort());
      // Category choices from the form first, then any other values already stored (e.g. imports).
      const fromForm = (questionFor(form, 'category')?.options ?? []).map((o) => o.label);
      const stored = rowsData.map((r) => r.category).filter((c): c is string => !!c && !fromForm.includes(c));
      setCategories([...fromForm, ...new Set(stored)]);
    });
  }, [event, stats?.total, form]);

  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runDecision(ids: string[], decision: Decision, reason?: string) {
    setNotice(null);
    setBusy(`Updating 0 / ${ids.length}…`);
    try {
      let summary = await decide(ids, decision, { reason, onProgress: (d, t) => setBusy(`Updating ${d} / ${t}…`) });
      if (summary.overCapacityIds.length) {
        const n = summary.overCapacityIds.length;
        if (window.confirm(`The event is at capacity (${event?.capacity}). Approve ${n} more anyway?`)) {
          const forced = await decide(summary.overCapacityIds, 'approved', { force: true });
          summary = {
            counts: { ...summary.counts, over_capacity: 0, updated: (summary.counts.updated ?? 0) + (forced.counts.updated ?? 0) },
            overCapacityIds: [],
            emailFailures: summary.emailFailures + forced.emailFailures,
          };
        }
      }
      setNotice({ tone: summary.emailFailures ? 'error' : 'ok', text: describeSummary(summary, decision) });
      setSelected(new Set());
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function exportCsv() {
    if (!event) return;
    setBusy('Preparing export…');
    try {
      const all: Registration[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase.from('registrations').select('*').eq('event_id', event.id).is('anonymized_at', null);
        q = applyFilters(q, filters, form);
        const { data, error } = await q.order('created_at').range(from, from + 999);
        if (error) throw error;
        all.push(...(data as Registration[]));
        if (!data || data.length < 1000) break;
      }
      downloadFile(`yim-registrations-${new Date().toISOString().slice(0, 10)}.csv`, registrationsToCsv(all, form));
      await supabase.rpc('log_export', { p_event: event.id, p_count: all.length, p_filters: filters });
    } catch (err) {
      setNotice({ tone: 'error', text: `Export failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  const sortHeader = (key: SortKey, label: string) => (
    <th scope="col" className="px-3 py-2.5 text-left">
      <button
        className="inline-flex items-center gap-1 font-semibold hover:text-navy"
        onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key !== 'created_at' }))}
        aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : undefined}
      >
        {label}
        <span aria-hidden="true" className="text-xs text-slate-400">{sort.key === key ? (sort.asc ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const selectedIds = useMemo(() => [...selected], [selected]);
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  if (!event) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-5">
      <StatsPanel stats={stats} event={event} showCategories={showCategories} onToggleCategories={() => setShowCategories((v) => !v)} />

      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label htmlFor="search" className="sr-only">Search</label>
            <input id="search" type="search" className="input" placeholder="Search name, email or organization" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <FilterSelect label="Status" value={filters.status} onChange={(v) => { setFilters((f) => ({ ...f, status: v as Status | '' })); setPage(0); }}
            options={STATUSES.map((s) => [s, statusLabel(s)])} />
          <FilterSelect label="Category" value={filters.category} onChange={(v) => { setFilters((f) => ({ ...f, category: v })); setPage(0); }}
            options={categories.map((c) => [c, c])} />
          <FilterSelect label="Country" value={filters.country} onChange={(v) => { setFilters((f) => ({ ...f, country: v })); setPage(0); }}
            options={countries.map((c) => [c, c])} />
          <FilterSelect label="Checked in" value={filters.checkedIn} onChange={(v) => { setFilters((f) => ({ ...f, checkedIn: v as Filters['checkedIn'] })); setPage(0); }}
            options={[['yes', 'Checked in'], ['no', 'Not checked in']]} />
          <FilterSelect label="Answer to question" value={filters.answerQ} onChange={(v) => { setFilters((f) => ({ ...f, answerQ: v, answerV: '' })); setPage(0); }}
            options={choiceQuestions.map((q) => [q.id, truncate(plainText(q.label), 60)])} />
          {filters.answerQ && (
            <FilterSelect label="Answer" value={filters.answerV} onChange={(v) => { setFilters((f) => ({ ...f, answerV: v })); setPage(0); }}
              options={(choiceQuestions.find((q) => q.id === filters.answerQ)?.options ?? []).map((o) => [o.label, truncate(o.label, 60)])} />
          )}
          {filtersActive && (
            <button className="btn-ghost" onClick={() => { setFilters(EMPTY_FILTERS); setSearchInput(''); setPage(0); }}>Clear</button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={() => setShowImport(true)}>Import CSV</button>
            <button className="btn-ghost" onClick={exportCsv} disabled={!!busy}>Export CSV</button>
          </div>
        </div>
      </div>

      {(notice || busy) && (
        <p role="status" className={`rounded-lg px-4 py-2.5 text-sm font-medium ${busy ? 'bg-navy-surface text-navy' : notice?.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
          {busy ?? notice?.text}
        </p>
      )}

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-navy p-3 text-white shadow-lg">
          <span className="mr-2 text-sm font-semibold">{selected.size} selected</span>
          <button className="btn bg-emerald-500 text-white hover:bg-emerald-600" disabled={!!busy} onClick={() => runDecision(selectedIds, 'approved')}>Approve</button>
          <button className="btn bg-red-500 text-white hover:bg-red-600" disabled={!!busy} onClick={() => setDeclineFor(selectedIds)}>Decline…</button>
          <button className="btn bg-sky-500 text-white hover:bg-sky-600" disabled={!!busy} onClick={() => runDecision(selectedIds, 'waitlisted')}>Waitlist</button>
          <button className="btn text-white/80 hover:text-white" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="w-10 px-3 py-2.5">
                <input type="checkbox" className="size-4 accent-navy" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all on this page" />
              </th>
              {sortHeader('full_name', 'Name')}
              {sortHeader('organization', 'Organization')}
              {sortHeader('category', 'Category')}
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">Country</th>
              {sortHeader('status', 'Status')}
              <th scope="col" className="px-3 py-2.5 text-left font-semibold" title="Photo / filming consent">Photo</th>
              {sortHeader('created_at', 'Registered')}
              {sortHeader('checked_in_at', 'Checked in')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={`cursor-pointer hover:bg-navy-surface ${selected.has(r.id) ? 'bg-sun-light' : ''}`} onClick={() => setOpenId(r.id)}>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="size-4 accent-navy" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.full_name}`} />
                </td>
                <td className="px-3 py-2.5">
                  <button className="text-left font-semibold text-slate-900 hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>
                    {r.full_name}
                  </button>
                  <div className="text-xs text-slate-500">{r.email}</div>
                  {r.age_group === 'under-18' && (
                    <span className={`mt-0.5 inline-block rounded px-1.5 text-[11px] font-semibold ${r.guardian_consent ? 'bg-sun-light text-amber-900' : 'bg-red-100 text-red-800'}`}>
                      Under 18{r.guardian_consent ? '' : ' · guardian consent needed'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{r.organization ?? '—'}</td>
                <td className="px-3 py-2.5">{r.category ?? '—'}</td>
                <td className="px-3 py-2.5">{r.country ?? '—'}</td>
                <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2.5">
                  {r.photo_consent
                    ? <span className="text-emerald-700" title="Consents to photos">✓ Yes</span>
                    : <span className="font-semibold text-red-700" title="No photos">✕ No</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{formatDateTime(r.created_at)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.checked_in_at ? formatDateTime(r.checked_in_at) : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-500">No registrants match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{count} registrant{count === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost px-3 py-1.5" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span>Page {page + 1} of {pages}</span>
          <button className="btn-ghost px-3 py-1.5" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      </div>

      {openId && (
        <RegistrantDrawer
          id={openId}
          version={version}
          form={form}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onDecide={(decision) => (decision === 'declined' ? setDeclineFor([openId]) : runDecision([openId], decision))}
        />
      )}
      {declineFor && (
        <DeclineDialog
          count={declineFor.length}
          onCancel={() => setDeclineFor(null)}
          onConfirm={(reason) => {
            const ids = declineFor;
            setDeclineFor(null);
            runDecision(ids, 'declined', reason);
          }}
        />
      )}
      {showImport && <ImportDialog eventId={event.id} form={form} onClose={() => setShowImport(false)} onImported={refresh} />}
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="text-xs font-semibold text-slate-500">
      <span className="mb-1 block">{label}</span>
      <select className="input max-w-64 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function StatsPanel({ stats, event, showCategories, onToggleCategories }: { stats: EventStats | null; event: EventRow; showCategories: boolean; onToggleCategories: () => void }) {
  const tiles: [string, number | undefined, string][] = [
    ['Registered', stats?.total, 'text-navy'],
    ['Pending', stats?.pending, 'text-amber-700'],
    ['Approved', stats?.approved, 'text-emerald-700'],
    ['Declined', stats?.declined, 'text-red-700'],
    ['Waitlisted', stats?.waitlisted, 'text-sky-700'],
    ['Checked in', stats?.checked_in, 'text-navy'],
    ['Spots left', stats?.remaining, 'text-slate-900'],
  ];
  return (
    <section aria-label="Statistics" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{event.name}</h1>
        <p className="text-sm text-slate-500">Capacity {event.capacity} (approved registrants) · updates every 15 s</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(([label, value, tone]) => (
          <div key={label} className="card px-4 py-3">
            <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
            <div className={`font-display text-3xl font-bold tabular-nums ${tone}`}>{value ?? '–'}</div>
          </div>
        ))}
      </div>
      {stats && (
        <div className="card">
          <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-navy" onClick={onToggleCategories} aria-expanded={showCategories}>
            Breakdown by category <span aria-hidden="true">{showCategories ? '▲' : '▼'}</span>
          </button>
          {showCategories && (
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-sm">
                <thead className="text-slate-500">
                  <tr>{['Category', 'Total', 'Pending', 'Approved', 'Declined', 'Waitlisted', 'Checked in'].map((h) => <th key={h} scope="col" className="px-4 py-2 text-left font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {stats.by_category.map((c) => (
                    <tr key={c.category}>
                      <td className="px-4 py-2 font-medium">{c.category}</td>
                      <td className="px-4 py-2">{c.total}</td>
                      <td className="px-4 py-2">{c.pending}</td>
                      <td className="px-4 py-2">{c.approved}</td>
                      <td className="px-4 py-2">{c.declined}</td>
                      <td className="px-4 py-2">{c.waitlisted}</td>
                      <td className="px-4 py-2">{c.checked_in}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
