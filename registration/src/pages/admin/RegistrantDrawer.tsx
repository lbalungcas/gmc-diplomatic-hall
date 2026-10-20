import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import type { Decision } from '../../lib/decide';
import { ageLabel, formatDateTime } from '../../lib/format';
import { answerText, plainText, questions, type FormSchema } from '../../lib/form';
import { ticketLink } from '../../lib/paths';
import { callFunction, supabase } from '../../lib/supabase';
import type { Registration } from '../../lib/types';

interface AuditRow {
  id: number;
  at: string;
  actor_email: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

interface EmailRow {
  id: number;
  type: string;
  template: string;
  status: 'sent' | 'failed' | 'skipped';
  error: string | null;
  sent_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  register: 'Registered',
  approve: 'Approved',
  decline: 'Declined',
  waitlist: 'Waitlisted',
  reset_pending: 'Moved back to pending',
  check_in: 'Checked in',
  undo_check_in: 'Check-in undone',
  resend_email: 'Email resent',
  guardian_consent: 'Guardian consent recorded',
};

export function RegistrantDrawer({ id, version, form, onClose, onChanged, onDecide }: {
  id: string;
  version: number;
  form: FormSchema;
  onClose: () => void;
  onChanged: () => void;
  onDecide: (decision: Decision) => void;
}) {
  const [reg, setReg] = useState<Registration | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const [r, a, e] = await Promise.all([
      supabase.from('registrations').select('*').eq('id', id).single(),
      supabase.from('audit_log').select('id, at, actor_email, action, before, after, meta').eq('registration_id', id).order('at', { ascending: false }),
      supabase.from('email_log').select('id, type, template, status, error, sent_at').eq('registration_id', id).order('sent_at', { ascending: false }),
    ]);
    setReg(r.data as Registration);
    setAudit((a.data ?? []) as AuditRow[]);
    setEmails((e.data ?? []) as EmailRow[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, version]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      await load();
      onChanged();
    }
  }

  const resend = () => act(async () => {
    const res = await callFunction<{ template: string; status: string }>('resend-email', { id });
    return res.status === 'skipped' ? 'Email logged but not sent (email provider not configured).' : `Re-sent the ${res.template} email.`;
  });

  const checkIn = () => act(async () => {
    const { data, error } = await supabase.rpc('check_in_manual', { p_id: id });
    if (error) throw error;
    return data.result === 'checked_in' ? 'Checked in.' : data.result === 'already_checked_in' ? 'Already checked in.' : 'Not approved — cannot check in.';
  });

  const undoCheckIn = () => act(async () => {
    const { error } = await supabase.rpc('undo_check_in', { p_id: id });
    if (error) throw error;
    return 'Check-in undone.';
  });

  const copyLink = async () => {
    if (!reg) return;
    await navigator.clipboard.writeText(ticketLink(reg.ticket_token));
    setMessage('Ticket link copied. Only share it with this registrant.');
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="drawer-title" className="text-xl font-bold">{reg?.full_name ?? 'Loading…'}</h2>
            {reg && <div className="mt-1"><StatusBadge status={reg.status} checkedIn={!!reg.checked_in_at} /></div>}
          </div>
          <button ref={closeRef} onClick={onClose} className="rounded-lg px-2 py-1 text-2xl text-slate-500 hover:bg-slate-100" aria-label="Close">×</button>
        </div>

        {reg && (
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <div className="flex flex-wrap gap-2">
              {reg.status !== 'approved' && <button className="btn bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy || !!reg.checked_in_at} onClick={() => onDecide('approved')}>Approve</button>}
              {reg.status !== 'declined' && <button className="btn bg-red-600 text-white hover:bg-red-700" disabled={busy || !!reg.checked_in_at} onClick={() => onDecide('declined')}>Decline…</button>}
              {reg.status !== 'waitlisted' && <button className="btn bg-sky-600 text-white hover:bg-sky-700" disabled={busy || !!reg.checked_in_at} onClick={() => onDecide('waitlisted')}>Waitlist</button>}
              {reg.status !== 'pending' && !reg.checked_in_at && <button className="btn-ghost" disabled={busy} onClick={() => onDecide('pending')} title="No email is sent">Move to pending</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy || reg.status === 'cancelled'} onClick={resend}>Resend {reg.status} email</button>
              {reg.status === 'approved' && !reg.checked_in_at && <button className="btn-primary" disabled={busy} onClick={checkIn}>Check in now</button>}
              {reg.checked_in_at && <button className="btn-ghost" disabled={busy} onClick={undoCheckIn}>Undo check-in</button>}
              <button className="btn-ghost" onClick={copyLink}>Copy ticket link</button>
            </div>
            {message && <p role="status" className="rounded-lg bg-navy-surface px-3 py-2 text-sm text-navy">{message}</p>}

            <Section title="Details">
              <dl className="space-y-1.5">
              <Field label="Preferred name" value={reg.preferred_name} />
              <Field label="Email" value={<a className="text-navy underline" href={`mailto:${reg.email}`}>{reg.email}</a>} />
              <Field label="Mobile" value={reg.phone} />
              <Field label="Organization" value={reg.organization} />
              <Field label="Category" value={reg.category} />
              <Field label="Age" value={ageLabel(reg.age, reg.age_group)} />
              <Field label="Nationality" value={reg.nationality} />
              <Field label="Country" value={reg.country} />
              {reg.age_group === 'under-18' && (
                <>
                  <Field label="Guardian" value={reg.guardian_name} />
                  <Field label="Guardian email" value={reg.guardian_email} />
                  <Field label="Guardian consent" value={reg.guardian_consent ? 'Yes' : <strong className="text-red-700">Missing — cannot be approved</strong>} />
                </>
              )}
              <Field label="Photo consent" value={reg.photo_consent ? 'Yes' : <strong className="text-red-700">No — do not photograph</strong>} />
              <Field label="Privacy consent" value={reg.privacy_consent ? 'Yes' : 'No'} />
              {reg.decline_reason && <Field label="Decline reason" value={reg.decline_reason} />}
              <Field label="Source" value={reg.source} />
              <Field label="Registered" value={formatDateTime(reg.created_at)} />
              <Field label="Decided" value={formatDateTime(reg.decided_at)} />
              <Field label="Checked in" value={formatDateTime(reg.checked_in_at)} />
              </dl>
            </Section>

            {reg.age_group === 'under-18' && !reg.guardian_consent && (
              <GuardianConsentForm id={reg.id} onSaved={async (msg) => { setMessage(msg); await load(); onChanged(); }} />
            )}

            <Section title="Form answers">
              <dl className="space-y-3">
                {questions(form).filter((q) => answerText(reg.answers?.[q.id])).map((q) => (
                  <div key={q.id} className="text-sm">
                    <dt className="text-slate-500">{plainText(q.label)}</dt>
                    <dd className="mt-0.5 break-words whitespace-pre-wrap text-slate-900">
                      {Array.isArray(reg.answers[q.id])
                        ? <ul className="list-disc pl-5">{(reg.answers[q.id] as string[]).map((v) => <li key={v}>{v}</li>)}</ul>
                        : answerText(reg.answers[q.id])}
                    </dd>
                  </div>
                ))}
                {Object.keys(reg.answers ?? {}).filter((k) => !questions(form).some((q) => q.id === k)).map((k) => (
                  <div key={k} className="text-sm">
                    <dt className="text-slate-500">(removed question) {k}</dt>
                    <dd className="mt-0.5 break-words text-slate-900">{answerText(reg.answers[k])}</dd>
                  </div>
                ))}
                {Object.keys(reg.answers ?? {}).length === 0 && <p className="text-sm text-slate-500">No form answers stored.</p>}
              </dl>
            </Section>

            <Section title="History">
              <ol className="space-y-2 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="w-28 shrink-0 text-slate-500">{formatDateTime(a.at)}</span>
                    <span>
                      <strong>{ACTION_LABELS[a.action] ?? a.action}</strong>
                      {a.actor_email && <span className="text-slate-500"> by {a.actor_email}</span>}
                      {a.meta?.over_capacity_override === true && <span className="text-amber-700"> (capacity override)</span>}
                      {typeof a.meta?.method === 'string' && <span className="text-slate-500"> ({a.meta.method})</span>}
                      {typeof a.after?.decline_reason === 'string' && <span className="block text-slate-500">“{a.after.decline_reason}”</span>}
                    </span>
                  </li>
                ))}
                {audit.length === 0 && <li className="text-slate-500">No history.</li>}
              </ol>
            </Section>

            <Section title="Emails">
              <ol className="space-y-2 text-sm">
                {emails.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-28 shrink-0 text-slate-500">{formatDateTime(e.sent_at)}</span>
                    <span>
                      <strong className="capitalize">{e.template}</strong>
                      {e.type === 'resend' && <span className="text-slate-500"> (resent)</span>}{' '}
                      <span className={e.status === 'sent' ? 'text-emerald-700' : e.status === 'failed' ? 'font-semibold text-red-700' : 'text-amber-700'}>
                        {e.status}
                      </span>
                      {e.error && <span className="block text-xs break-words text-slate-500">{e.error}</span>}
                    </span>
                  </li>
                ))}
                {emails.length === 0 && <li className="text-slate-500">No emails yet.</li>}
              </ol>
            </Section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{value || '—'}</dd>
    </div>
  );
}

/** For under-18s whose guardian consent was collected outside the form (e.g. imported rows). */
function GuardianConsentForm({ id, onSaved }: { id: string; onSaved: (message: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('record_guardian_consent', { p_id: id, p_name: name, p_email: email });
    setBusy(false);
    if (error) setError(error.message);
    else onSaved('Guardian consent recorded. This registrant can now be approved.');
  }

  return (
    <section className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <h3 className="text-sm font-bold text-red-900">Record parent / guardian consent</h3>
      <p className="text-sm text-red-900">This participant is under 18. Approval is blocked until a parent or guardian has consented.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Guardian full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Guardian full name" />
        <input className="input" type="email" placeholder="Guardian email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Guardian email" />
      </div>
      <label className="flex items-start gap-2 text-sm text-red-950">
        <input type="checkbox" className="mt-0.5 size-4 accent-navy" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I confirm this parent/guardian has given consent (e.g. by email or a signed form), and the evidence is kept on file.
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary" disabled={busy || !confirmed || !name.trim() || !email.trim()} onClick={save}>Save consent</button>
    </section>
  );
}
