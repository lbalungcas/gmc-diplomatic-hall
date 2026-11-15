import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { checkoutLink, publicUrl } from '../../lib/paths';
import { supabase } from '../../lib/supabase';
import { useEvent } from '../../lib/useEvent';

interface Station {
  code: string;
  rotated_at: string;
}

/** The printable QR poster for the exit. Guests scan it with their own phone to check out. */
export default function CheckoutPoster() {
  const { event } = useEvent();
  const [station, setStation] = useState<Station | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!event) return;
    supabase.rpc('checkout_station', { p_event: event.id }).then(({ data, error }) => {
      if (error) setError(error.message);
      else setStation(data as Station);
    });
  }, [event]);

  async function rotate() {
    if (!event) return;
    if (!window.confirm('Make a new check-out code? Posters already printed will stop working, so you will need to print and put up the new one.')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('rotate_checkout_station', { p_event: event.id });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setStation(data as Station);
      setMessage('New code made. Print the poster again and replace the old one.');
    }
  }

  async function copy() {
    if (!station) return;
    await navigator.clipboard.writeText(checkoutLink(station.code));
    setMessage('Check-out link copied.');
  }

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-red-900">{error}</p>;
  if (!event || !station) return <p className="py-10 text-center text-slate-500">Loading…</p>;

  const url = checkoutLink(station.code);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Check-out QR poster</h1>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => window.print()}>Print poster</button>
            <button type="button" className="btn-ghost" onClick={copy}>Copy link</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={rotate}>Make a new code</button>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Put this poster at every exit. Guests scan it with their phone and tap <strong>Check out</strong>. It uses the ticket they opened on that phone.
          Guests without a phone can be checked out from the scanner (switch it to <strong>Check out</strong>) or from Manual check-in.
          Only make a new code if a photo of the poster is being shared. Code created {formatDateTime(station.rotated_at)}.
        </p>
        {message && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 font-semibold text-emerald-900">{message}</p>}
      </div>

      <section className="card flex flex-col items-center gap-6 px-8 py-10 text-center print:border-0 print:shadow-none">
        <img src={publicUrl('brand/logo.png')} alt="Youth Innovations Marketplace" className="h-16 w-auto" width="179" height="80" />
        <div>
          <p className="text-sm font-semibold tracking-widest text-slate-500 uppercase">{event.name}</p>
          <h2 className="mt-2 font-display text-5xl font-extrabold text-navy">Leaving? Check out here</h2>
        </div>
        <div className="rounded-3xl border-4 border-navy p-5">
          <QRCodeSVG value={url} size={340} level="M" fgColor="#0f2240" marginSize={0} title="Check-out QR code" />
        </div>
        <ol className="space-y-1 text-left text-xl text-slate-800">
          <li><strong>1.</strong> Open your phone's camera</li>
          <li><strong>2.</strong> Scan this code</li>
          <li><strong>3.</strong> Tap <strong>Check out</strong></li>
        </ol>
        <p className="text-base text-slate-600">No phone? The registration desk can check you out.</p>
      </section>
    </div>
  );
}
