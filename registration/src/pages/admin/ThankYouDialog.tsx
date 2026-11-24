import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import {
  previewThankYou, sendThankYou, sendThankYouTest, thankYouAudience,
  type ThankYouAudience, type ThankYouSummary, type ThankYouVariant,
} from '../../lib/thankYou';

const VARIANTS: [ThankYouVariant, string, string][] = [
  ['attended', 'Attended', 'For everyone who checked in on 17 November'],
  ['registered', "Registered, didn't attend", 'For everyone who registered but never checked in'],
];

/**
 * Post-event thank-you: who it reaches, a preview of both versions, a test copy to yourself, then
 * the send. Nothing goes out until the final button and its confirmation.
 */
export function ThankYouDialog({ eventId, onlyIds, onClose, onSent }: {
  eventId: string;
  /** Send to these registrations only (the dashboard selection); otherwise everyone registered. */
  onlyIds?: string[];
  onClose: () => void;
  onSent: (summary: ThankYouSummary) => void;
}) {
  const [audience, setAudience] = useState<ThankYouAudience | null>(null);
  const [variant, setVariant] = useState<ThankYouVariant>('attended');
  const [preview, setPreview] = useState<Record<string, { subject: string; html: string }>>({});
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    thankYouAudience(eventId, onlyIds)
      .then(setAudience)
      .catch((err) => setMessage({ tone: 'error', text: (err as Error).message }));
  }, [eventId, onlyIds]);

  useEffect(() => {
    if (preview[variant]) return;
    previewThankYou(eventId, variant)
      .then((p) => setPreview((all) => ({ ...all, [variant]: p })))
      .catch((err) => setMessage({ tone: 'error', text: `Preview failed: ${(err as Error).message}. Has the send-thank-you function been deployed?` }));
  }, [eventId, variant, preview]);

  async function sendTest() {
    setMessage(null);
    setBusy('Sending a test copy…');
    try {
      const res = await sendThankYouTest(eventId, variant);
      setMessage(res.outcome === 'sent'
        ? { tone: 'ok', text: `Test copy of the "${VARIANTS.find((v) => v[0] === variant)?.[1]}" version sent to ${res.to}.` }
        : { tone: 'error', text: res.outcome === 'skipped' ? 'Not sent: the email provider is not configured (RESEND_API_KEY).' : `Test failed: ${res.error}` });
    } catch (err) {
      setMessage({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const toSend = audience ? audience.people - (force ? 0 : audience.alreadySent) : 0;

  async function send() {
    if (!audience || toSend === 0) return;
    if (!window.confirm(`Email the thank-you to ${toSend} ${toSend === 1 ? 'person' : 'people'}?\n\nThis can't be undone.`)) return;
    setMessage(null);
    setBusy(`Sending 0 / ${audience.ids.length}…`);
    try {
      const summary = await sendThankYou(audience.ids, { force, onProgress: (d, t) => setBusy(`Sending ${d} / ${t}…`) });
      onSent(summary);
    } catch (err) {
      setMessage({ tone: 'error', text: `Sending stopped: ${(err as Error).message}. Press Send again to continue; people already emailed are skipped.` });
      setAudience(await thankYouAudience(eventId, onlyIds).catch(() => audience));
    } finally {
      setBusy(null);
    }
  }

  const current = preview[variant];

  return (
    <Modal title={onlyIds ? `Thank-you email to ${onlyIds.length} selected` : 'Thank-you email to everyone registered'} onClose={busy ? () => {} : onClose} wide>
      <div className="space-y-4">
        {audience ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="People" value={audience.people} hint="distinct email addresses" />
            <Stat label="Attended" value={audience.attended} hint="get the “Attended” version" />
            <Stat label="Didn’t attend" value={audience.people - audience.attended} hint="get the “Registered” version" />
            <Stat label="Already sent" value={audience.alreadySent} hint="skipped" />
          </div>
        ) : (
          <p className="text-sm text-slate-500">Counting registrants…</p>
        )}
        {audience && audience.excluded > 0 && (
          <p className="text-sm text-slate-600">{audience.excluded} declined or cancelled registration{audience.excluded === 1 ? ' is' : 's are'} left out.</p>
        )}

        <div>
          <div className="mb-2 flex flex-wrap gap-2" role="tablist" aria-label="Email version">
            {VARIANTS.map(([key, label, hint]) => (
              <button key={key} role="tab" aria-selected={variant === key} title={hint}
                className={variant === key ? 'btn-primary' : 'btn-ghost'} onClick={() => setVariant(key)}>
                {label}
              </button>
            ))}
          </div>
          {current ? (
            <>
              <p className="mb-2 text-sm"><span className="text-slate-500">Subject:</span> <strong>{current.subject}</strong></p>
              <iframe title="Email preview" srcDoc={current.html} sandbox="allow-popups"
                className="h-[26rem] w-full rounded-lg border border-slate-200 bg-slate-100" />
            </>
          ) : (
            <div className="grid h-40 place-items-center rounded-lg border border-slate-200 text-sm text-slate-500">Loading preview…</div>
          )}
        </div>

        {audience && audience.alreadySent > 0 && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 size-4 accent-navy" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Also send again to the {audience.alreadySent} {audience.alreadySent === 1 ? 'person who' : 'people who'} already received it
          </label>
        )}

        {(busy || message) && (
          <p role="status" className={`rounded-lg px-4 py-2.5 text-sm font-medium ${busy ? 'bg-navy-surface text-navy' : message?.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
            {busy ?? message?.text}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <button className="btn-ghost" onClick={onClose} disabled={!!busy}>Close</button>
          <button className="btn-ghost" onClick={sendTest} disabled={!!busy || !current} title="Sends the version shown above to your own email address">
            Send me a test
          </button>
          <button className="btn-primary" onClick={send} disabled={!!busy || !audience || toSend === 0}>
            {audience ? (toSend === 0 ? 'Everyone already has it' : `Send to ${toSend} ${toSend === 1 ? 'person' : 'people'}`) : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xl font-bold text-navy">{value}</div>
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </div>
  );
}

