import { useState } from 'react';
import { formatTime } from '../lib/format';
import { supabase } from '../lib/supabase';

/** Ticks or unticks "Received Reg Kit?" for a checked-in guest. Returns the new kit_received_at. */
export async function setKitReceived(id: string, received: boolean): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_kit_received', { p_id: id, p_received: received });
  if (error) throw error;
  return (data as { kit_received_at: string | null }).kit_received_at;
}

interface Props {
  id: string;
  kitReceivedAt: string | null;
  onChange: (kitReceivedAt: string | null) => void;
  /** Large dark-background variant for the scanner. */
  size?: 'normal' | 'large';
}

export function KitToggle({ id, kitReceivedAt, onChange, size = 'normal' }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const given = !!kitReceivedAt;

  async function toggle() {
    if (given && !window.confirm('Mark the reg kit as NOT given?')) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await setKitReceived(id, !given));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const large = size === 'large';
  const tone = given
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : large ? 'bg-sun text-navy-dark hover:brightness-95' : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50';

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className={`btn ${large ? 'px-6 py-4 text-lg font-bold' : 'px-4 py-2.5 text-sm font-semibold'} ${tone}`}
        onClick={toggle}
        disabled={busy}
        aria-pressed={given}
        title={given ? 'Tap to undo' : 'Tap after handing over the reg kit'}
      >
        {busy ? 'Saving…' : given ? `✓ Kit given ${formatTime(kitReceivedAt)}` : 'Kit given'}
      </button>
      {error && <span role="alert" className={`text-xs font-semibold ${large ? 'text-red-300' : 'text-red-700'}`}>{error}</span>}
    </span>
  );
}
