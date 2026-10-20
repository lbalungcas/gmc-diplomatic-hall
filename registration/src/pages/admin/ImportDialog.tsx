import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { OTHER_PREFIX, plainText, questions, type Answers, type FormQuestion, type FormSchema } from '../../lib/form';
import { callFunction } from '../../lib/supabase';

const norm = (s: string) => plainText(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Google Forms' CSV joins checkbox answers with ", ", but option labels contain commas too —
 *  so match known option labels (longest first) and treat whatever is left as "Other". */
function parseCheckbox(value: string, q: FormQuestion): string[] {
  let rest = value;
  const picked: string[] = [];
  for (const o of [...(q.options ?? [])].sort((a, b) => b.label.length - a.label.length)) {
    if (rest.includes(o.label)) {
      picked.push(o.label);
      rest = rest.replace(o.label, '');
    }
  }
  const leftover = rest.replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/\s*,\s*,\s*/g, ', ');
  if (leftover && q.allowOther) picked.push(OTHER_PREFIX + leftover);
  // Keep the form's option order.
  const order = (q.options ?? []).map((o) => o.label);
  return picked.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
}

function parseRadio(value: string, q: FormQuestion): string {
  if ((q.options ?? []).some((o) => o.label === value)) return value;
  return q.allowOther ? OTHER_PREFIX + value : value;
}

interface Result {
  inserted: number;
  duplicates: number;
  minorsNeedingConsent: number;
  errors: { row: number; error: string }[];
}

export function ImportDialog({ eventId, form, onClose, onImported }: { eventId: string; form: FormSchema; onClose: () => void; onImported: () => void }) {
  const qs = useMemo(() => questions(form), [form]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [timestampCol, setTimestampCol] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function onFile(file: File) {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const fields = res.meta.fields ?? [];
        setHeaders(fields);
        setRows(res.data);
        // Exact match on the question text first, then "header starts with the question".
        const guess: Record<string, string> = {};
        const used = new Set<string>();
        for (const q of qs) {
          const target = norm(q.label);
          const h = fields.find((f) => !used.has(f) && norm(f) === target) ?? fields.find((f) => !used.has(f) && target && norm(f).startsWith(target));
          if (h) {
            guess[q.id] = h;
            used.add(h);
          }
        }
        setMapping(guess);
        setTimestampCol(fields.find((f) => /timestamp/i.test(f)) ?? '');
      },
      error: (err) => setError(err.message),
    });
  }

  const payload = useMemo(
    () =>
      rows.map((r) => {
        const answers: Answers = {};
        for (const q of qs) {
          const col = mapping[q.id];
          const raw = col ? (r[col] ?? '').trim() : '';
          if (!raw) continue;
          answers[q.id] = q.kind === 'checkbox' ? parseCheckbox(raw, q) : q.kind === 'radio' ? parseRadio(raw, q) : raw;
        }
        return { answers, created_at: timestampCol ? r[timestampCol] : null };
      }),
    [rows, mapping, qs, timestampCol],
  );

  const nameQ = qs.find((q) => q.mapsTo === 'full_name');
  const emailQ = qs.find((q) => q.mapsTo === 'email');

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await callFunction<Result>('import-registrations', { event_id: eventId, rows: payload, consent_confirmed: consent });
      setResult(res);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canImport = rows.length > 0 && !!nameQ && !!emailQ && !!mapping[nameQ.id] && !!mapping[emailQ.id] && consent && !busy;
  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <Modal title="Import registrations from CSV" onClose={onClose} wide>
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-emerald-50 p-3 text-emerald-900">
            Imported <strong>{result.inserted}</strong> as Pending. {result.duplicates} skipped (email already registered).
            No emails were sent — approve them to send QR tickets.
          </p>
          {result.minorsNeedingConsent > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
              {result.minorsNeedingConsent} imported participant(s) are under 18. They are marked
              <strong> "guardian consent needed"</strong> and can't be approved until you record a parent/guardian's consent in
              their details.
            </p>
          )}
          {result.errors.length > 0 && (
            <div>
              <p className="font-semibold text-red-800">{result.errors.length} row(s) not imported:</p>
              <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-red-900">
                {result.errors.map((e) => <li key={e.row}>Row {e.row + 1}: {e.error}</li>)}
              </ul>
              <p className="mt-1 text-xs text-slate-500">Row numbers match the spreadsheet (row 1 is the header).</p>
            </div>
          )}
          <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <div>
            <label htmlFor="csv-file" className="label">CSV file (Google Forms → Responses → ⋮ → Download responses (.csv))</label>
            <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-navy file:px-4 file:py-2 file:font-semibold file:text-white" />
          </div>

          {headers.length > 0 && (
            <>
              <p className="text-slate-600">
                <strong>{rows.length}</strong> rows found. <strong>{mappedCount}</strong> of {qs.length} questions matched a column —
                check the matches below.
              </p>
              <div className="max-h-[40dvh] space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                <label className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]">
                  <span className="font-medium">Submitted at (timestamp)</span>
                  <select className="input py-1.5 text-sm" value={timestampCol} onChange={(e) => setTimestampCol(e.target.value)}>
                    <option value="">— not in file —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
                {qs.map((q) => (
                  <label key={q.id} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]">
                    <span className="font-medium">
                      {plainText(q.label)}
                      {(q.mapsTo === 'full_name' || q.mapsTo === 'email') && <span className="text-tdh-red"> *</span>}
                    </span>
                    <select className={`input py-1.5 text-sm ${mapping[q.id] ? '' : 'text-slate-400'}`} value={mapping[q.id] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [q.id]: e.target.value }))}>
                      <option value="">— not in file —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr>{['Name', 'Email', 'Organization', 'Category'].map((h) => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}</tr></thead>
                  <tbody>
                    {payload.slice(0, 4).map((p, i) => {
                      const v = (field: string) => {
                        const q = qs.find((x) => x.mapsTo === field);
                        const a = q ? p.answers[q.id] : undefined;
                        return Array.isArray(a) ? a.join('; ') : a ?? '';
                      };
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1.5">{v('full_name')}</td><td className="px-2 py-1.5">{v('email')}</td>
                          <td className="px-2 py-1.5">{v('organization')}</td><td className="px-2 py-1.5">{v('category')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label className="flex items-start gap-3 rounded-lg bg-sun-light p-3">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-navy" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I confirm these people agreed to the organisers using their data for this event when they filled in the original
                  form. Under-18s are imported as "guardian consent needed" and can't be approved until consent is recorded.
                </span>
              </label>
            </>
          )}

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!canImport} onClick={runImport}>{busy ? 'Importing…' : `Import ${rows.length || ''} rows`}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
