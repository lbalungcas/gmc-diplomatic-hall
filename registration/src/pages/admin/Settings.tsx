import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useEvent } from '../../lib/useEvent';

// Manila is UTC+8 all year (no DST), so a fixed offset is exact.
const OFFSET_MS = 8 * 3600 * 1000;
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+08:00`).toISOString() : null);

export default function Settings() {
  const { event, reload } = useEvent();
  const [form, setForm] = useState({ capacity: 200, opens: '', closes: '', auto_waitlist: true, contact_email: '', arrival_note: '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!event) return;
    setForm({
      capacity: event.capacity,
      opens: toLocalInput(event.registration_opens_at),
      closes: toLocalInput(event.registration_closes_at),
      auto_waitlist: event.auto_waitlist,
      contact_email: event.contact_email,
      arrival_note: event.arrival_note ?? '',
    });
  }, [event]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!event) return;
    setSaving(true);
    const { error } = await supabase
      .from('events')
      .update({
        capacity: form.capacity,
        registration_opens_at: fromLocalInput(form.opens),
        registration_closes_at: fromLocalInput(form.closes),
        auto_waitlist: form.auto_waitlist,
        contact_email: form.contact_email.trim(),
        arrival_note: form.arrival_note.trim() || null,
      })
      .eq('id', event.id);
    setSaving(false);
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: 'Saved.' });
    if (!error) reload();
  }

  if (!event) return <p className="text-slate-500">Loading…</p>;

  return (
    <form onSubmit={onSubmit} className="card mx-auto max-w-xl space-y-5 p-6">
      <h1 className="text-2xl font-bold">Event settings</h1>
      <div>
        <label htmlFor="capacity" className="label">Capacity</label>
        <input id="capacity" type="number" min={1} required className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
        <p className="mt-1 text-xs text-slate-500">Counts <strong>approved</strong> registrants only. Approving beyond this asks for confirmation.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="opens" className="label">Registration opens</label>
          <input id="opens" type="datetime-local" className="input" value={form.opens} onChange={(e) => setForm({ ...form, opens: e.target.value })} />
        </div>
        <div>
          <label htmlFor="closes" className="label">Registration closes</label>
          <input id="closes" type="datetime-local" className="input" value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">Manila time. Leave empty for no limit.</p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 accent-navy" checked={form.auto_waitlist} onChange={(e) => setForm({ ...form, auto_waitlist: e.target.checked })} />
        <span><strong>Auto-waitlist when full.</strong> Once approved registrants reach capacity, new registrations go straight to the waitlist and get the waitlist email.</span>
      </label>
      <div>
        <label htmlFor="contact" className="label">Contact email (shown in emails and on tickets)</label>
        <input id="contact" type="email" required className="input" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
      </div>
      <div>
        <label htmlFor="arrival" className="label">Arrival note (in the confirmation email)</label>
        <textarea id="arrival" rows={3} className="input" value={form.arrival_note} onChange={(e) => setForm({ ...form, arrival_note: e.target.value })} />
      </div>
      {message && <p role="status" className={`text-sm font-semibold ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</p>}
      <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}
