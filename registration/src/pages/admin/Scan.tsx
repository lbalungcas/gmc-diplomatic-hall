import { Scanner, type IDetectedBarcode, type IScannerError } from '@yudiel/react-qr-scanner';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KitToggle } from '../../components/KitToggle';
import { useAuth } from '../../lib/auth';
import { formatTime } from '../../lib/format';
import { ticketTokenFrom } from '../../lib/paths';
import { supabase } from '../../lib/supabase';
import type { CheckInResult, CheckOutResult, EventStats } from '../../lib/types';
import { useEvent } from '../../lib/useEvent';

type Shown = CheckInResult | CheckOutResult | { result: 'network_error' };
type Mode = 'in' | 'out';
type Stats = Pick<EventStats, 'checked_in' | 'approved' | 'kit_received' | 'checked_out' | 'on_site'>;

const MODE_KEY = 'yim.scanMode';
const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'out' ? 'out' : 'in';
  } catch {
    return 'in';
  }
};

/** The guest who was just admitted, so door staff can tick "Kit given" after the result screen closes. */
interface LastGuest {
  id: string;
  name: string;
  photo_consent: boolean;
  kit_received_at: string | null;
}

const RESULT_MS = 2000;

// ── Feedback: distinct tones + vibration so staff don't have to read the screen every time. ──
let audio: AudioContext | null = null;
function unlockAudio() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
}
function tone(freqs: number[], ms: number, type: OscillatorType = 'sine') {
  if (!audio) return;
  freqs.forEach((f, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = type;
    osc.frequency.value = f;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(audio!.destination);
    const start = audio!.currentTime + (i * ms) / 1000;
    osc.start(start);
    osc.stop(start + ms / 1000);
  });
}
function feedback(kind: Shown['result']) {
  if (kind === 'checked_in') {
    tone([880, 1320], 110);
    navigator.vibrate?.(80);
  } else if (kind === 'checked_out') {
    tone([1320, 880], 110);
    navigator.vibrate?.(80);
  } else if (kind === 'already_checked_in' || kind === 'already_checked_out' || kind === 'not_checked_in') {
    tone([660, 660], 140, 'triangle');
    navigator.vibrate?.([80, 80, 80]);
  } else {
    tone([180], 450, 'square');
    navigator.vibrate?.([250, 100, 250]);
  }
}

export default function Scan() {
  const { role } = useAuth();
  const { event } = useEvent();
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [processing, setProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [manual, setManual] = useState('');
  const [lastGuest, setLastGuest] = useState<LastGuest | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const loadStats = useCallback(async () => {
    if (!event) return;
    const { data } = await supabase.rpc('event_stats', { p_event: event.id });
    if (data) {
      setStats({
        checked_in: data.checked_in,
        approved: data.approved,
        kit_received: data.kit_received ?? 0,
        checked_out: data.checked_out ?? 0,
        on_site: data.on_site ?? data.checked_in,
      });
    }
  }, [event]);

  function setMode(m: Mode) {
    setModeState(m);
    setShown(null);
    setLastGuest(null);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Not remembered across reloads; still works.
    }
  }

  function onKitChange(kitReceivedAt: string | null) {
    const delta = kitReceivedAt && !lastGuest?.kit_received_at ? 1 : !kitReceivedAt && lastGuest?.kit_received_at ? -1 : 0;
    setLastGuest((g) => (g ? { ...g, kit_received_at: kitReceivedAt } : g));
    if (delta) setStats((s) => (s ? { ...s, kit_received: s.kit_received + delta } : s));
  }

  useEffect(() => {
    loadStats();
    const t = setInterval(() => document.visibilityState === 'visible' && loadStats(), 15000);
    return () => clearInterval(t);
  }, [loadStats]);

  const show = useCallback((r: Shown) => {
    setShown(r);
    feedback(r.result);
    window.clearTimeout(hideTimer.current);
    const ok = r.result === 'checked_in' || r.result === 'checked_out';
    hideTimer.current = window.setTimeout(() => setShown(null), ok ? RESULT_MS : RESULT_MS + 1000);
  }, []);

  const process = useCallback(async (raw: string) => {
    const token = ticketTokenFrom(raw);
    if (!token) {
      show({ result: 'invalid' });
      return;
    }
    setProcessing(true);
    try {
      if (mode === 'out') {
        const { data, error } = await supabase.rpc('check_out', { p_token: token });
        if (error) throw error;
        const r = data as CheckOutResult;
        show(r);
        if (r.result === 'checked_out') setStats((s) => (s ? { ...s, checked_out: s.checked_out + 1, on_site: s.on_site - 1 } : s));
        setLastGuest(null);
        return;
      }
      const { data, error } = await supabase.rpc('check_in', { p_token: token });
      if (error) throw error;
      const r = data as CheckInResult;
      show(r);
      if (r.result === 'checked_in') {
        setStats((s) => (!s ? s : r.returned
          ? { ...s, checked_out: s.checked_out - 1, on_site: s.on_site + 1 }
          : { ...s, checked_in: s.checked_in + 1, on_site: s.on_site + 1 }));
      }
      if (r.result === 'checked_in' || r.result === 'already_checked_in') {
        setLastGuest({ id: r.registration_id, name: r.full_name, photo_consent: r.photo_consent, kit_received_at: r.kit_received_at ?? null });
      } else {
        setLastGuest(null);
      }
    } catch {
      show({ result: 'network_error' });
    } finally {
      setProcessing(false);
    }
  }, [show, mode]);

  const onScan = useCallback((codes: IDetectedBarcode[]) => {
    if (codes[0]?.rawValue) process(codes[0].rawValue);
  }, [process]);

  const onError = useCallback((err: IScannerError) => {
    const messages: Partial<Record<IScannerError['kind'], string>> = {
      'permission-denied': 'Camera permission was denied. Allow camera access in your browser settings, then reload.',
      'no-camera': 'No camera found on this device.',
      'in-use': 'The camera is being used by another app.',
      'insecure-context': 'The camera only works over HTTPS.',
    };
    setCameraError(messages[err.kind] ?? `Camera error: ${err.message}`);
  }, []);

  function onManual(e: FormEvent) {
    e.preventDefault();
    if (!manual.trim()) return;
    unlockAudio();
    process(manual);
    setManual('');
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <Link to={role === 'admin' ? '/admin' : '/admin/checkin'} className="text-sm font-semibold text-white/70 hover:text-white">← Back</Link>
        {mode === 'in' ? (
          <div className="text-center" aria-live="polite">
            <span className="font-display text-3xl font-bold tabular-nums">{stats ? stats.checked_in : '–'}</span>
            <span className="text-xl text-white/60 tabular-nums"> / {stats ? stats.approved : '–'}</span>
            <div className="text-xs tracking-wide text-white/60 uppercase">
              checked in · {stats ? stats.kit_received : '–'} kits
            </div>
          </div>
        ) : (
          <div className="text-center" aria-live="polite">
            <span className="font-display text-3xl font-bold tabular-nums">{stats ? stats.on_site : '–'}</span>
            <div className="text-xs tracking-wide text-white/60 uppercase">
              on site · {stats ? stats.checked_out : '–'} checked out
            </div>
          </div>
        )}
        <Link to="/admin/checkin" className="text-sm font-semibold text-white/70 hover:text-white">Search</Link>
      </header>

      <div role="radiogroup" aria-label="Scanner mode" className="grid grid-cols-2 gap-1 px-3 pb-3">
        {(['in', 'out'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-2.5 text-base font-bold ${
              mode === m ? (m === 'in' ? 'bg-emerald-500 text-white' : 'bg-sky-500 text-white') : 'bg-white/10 text-white/70'
            }`}
          >
            {m === 'in' ? 'Check in' : 'Check out'}
          </button>
        ))}
      </div>

      <div className={`relative flex-1 overflow-hidden ${mode === 'out' ? 'ring-4 ring-sky-500 ring-inset' : ''}`}>
        {!started ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="mb-6 text-lg text-white/80">
                {mode === 'in' ? 'Point the camera at a ticket QR code to check the guest in.' : "Point the camera at a guest's ticket QR code to check them out."}
                {' '}Results show for 2 seconds, then scanning resumes.
              </p>
              <button
                className="rounded-2xl bg-sun px-10 py-5 font-display text-2xl font-bold text-navy-dark"
                onClick={() => { unlockAudio(); setStarted(true); }}
              >
                Start scanning
              </button>
            </div>
          </div>
        ) : cameraError ? (
          <div className="grid h-full place-items-center p-6 text-center text-lg">
            <p>{cameraError}<br /><span className="text-white/60">Use manual entry below, or the Search page.</span></p>
          </div>
        ) : (
          <Scanner
            onScan={onScan}
            onError={onError}
            formats={['qr_code']}
            paused={!!shown || processing}
            sound={false}
            constraints={{ facingMode: 'environment' }}
            components={{ finder: true, torch: true }}
            styles={{ container: { width: '100%', height: '100%' }, video: { objectFit: 'cover' } }}
          />
        )}

        {processing && !shown && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-2xl font-bold">Checking…</div>
        )}
        {started && !cameraError && mode === 'out' && !shown && (
          <div className="pointer-events-none absolute inset-x-0 top-3 text-center">
            <span className="rounded-full bg-sky-500 px-4 py-1.5 text-sm font-black tracking-wide uppercase">Check-out mode</span>
          </div>
        )}
        {shown && <ResultScreen r={shown} onDismiss={() => setShown(null)} />}
      </div>

      {lastGuest && (
        <div className="flex items-center gap-3 border-t border-white/10 bg-white/5 px-3 py-2.5" aria-label="Last guest">
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{lastGuest.name}</div>
            <span className={`mt-0.5 inline-block rounded px-2 py-0.5 text-xs font-black ${lastGuest.photo_consent ? 'bg-white/15' : 'bg-black text-white ring-1 ring-white/40'}`}>
              {lastGuest.photo_consent ? 'Photos OK' : 'NO PHOTOS'}
            </span>
          </div>
          <KitToggle key={lastGuest.id} id={lastGuest.id} kitReceivedAt={lastGuest.kit_received_at} onChange={onKitChange} size="large" />
        </div>
      )}

      <form onSubmit={onManual} className="flex gap-2 border-t border-white/10 p-3">
        <label htmlFor="manual" className="sr-only">Ticket code or link</label>
        <input
          id="manual"
          className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-3 text-base text-white placeholder:text-white/40"
          placeholder="Type or paste ticket code / link"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button className="rounded-lg bg-white px-5 font-semibold text-slate-900">{mode === 'in' ? 'Check in' : 'Check out'}</button>
      </form>
    </div>
  );
}

function ResultScreen({ r, onDismiss }: { r: Shown; onDismiss: () => void }) {
  const person = 'full_name' in r ? r : null;
  const returned = r.result === 'checked_in' && 'returned' in r && r.returned;
  const config = {
    checked_in: { bg: 'bg-emerald-600', fg: 'text-white', icon: '✓', title: returned ? 'Welcome back' : 'Checked in' },
    already_checked_in: { bg: 'bg-amber-400', fg: 'text-slate-950', icon: '!', title: 'Already checked in' },
    checked_out: { bg: 'bg-sky-600', fg: 'text-white', icon: '→', title: 'Checked out' },
    already_checked_out: { bg: 'bg-amber-400', fg: 'text-slate-950', icon: '!', title: 'Already checked out' },
    not_checked_in: { bg: 'bg-amber-400', fg: 'text-slate-950', icon: '!', title: 'Not checked in' },
    not_approved: { bg: 'bg-red-700', fg: 'text-white', icon: '✕', title: 'Not approved' },
    invalid: { bg: 'bg-red-700', fg: 'text-white', icon: '✕', title: 'Invalid code' },
    network_error: { bg: 'bg-slate-700', fg: 'text-white', icon: '⟳', title: 'No connection — scan again' },
  }[r.result];

  return (
    <button
      onClick={onDismiss}
      className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center ${config.bg} ${config.fg}`}
      aria-live="assertive"
    >
      <span className="font-display text-8xl leading-none font-black" aria-hidden="true">{config.icon}</span>
      <span className="font-display text-4xl font-extrabold uppercase">{config.title}</span>
      {r.result === 'not_approved' && person && (
        <span className="rounded-full bg-white/20 px-4 py-1 text-xl font-bold uppercase">Status: {person.status}</span>
      )}
      {person && (
        <>
          <span className="mt-2 text-4xl leading-tight font-bold">{person.full_name}</span>
          {person.preferred_name && person.preferred_name !== person.full_name && (
            <span className="text-2xl opacity-90">“{person.preferred_name}”</span>
          )}
          {person.organization && <span className="text-2xl opacity-90">{person.organization}</span>}
          <span className="text-xl opacity-80">{person.category}</span>
          {r.result === 'already_checked_in' && (
            <span className="mt-1 text-2xl font-bold">First check-in at {formatTime(person.checked_in_at)}</span>
          )}
          {r.result === 'already_checked_out' && (
            <span className="mt-1 text-2xl font-bold">Checked out at {formatTime(person.checked_out_at)}</span>
          )}
          {returned && <span className="mt-1 text-xl font-bold">First check-in at {formatTime(person.checked_in_at)}</span>}
          {(r.result === 'checked_in' || r.result === 'already_checked_in') && (
            <span className={`mt-3 rounded-xl px-5 py-2 text-2xl font-black ${person.photo_consent ? 'bg-white/20' : 'bg-black text-white'}`}>
              {person.photo_consent ? '📷 Photos OK' : '🚫 NO PHOTOS'}
            </span>
          )}
        </>
      )}
      {r.result === 'invalid' && <span className="text-xl opacity-90">This is not a valid ticket. Send the guest to the help desk.</span>}
      {r.result === 'not_approved' && <span className="text-xl opacity-90">Do not admit. Send the guest to the help desk.</span>}
      {r.result === 'not_checked_in' && <span className="text-xl opacity-90">This guest was never checked in, so there is nothing to check out.</span>}
    </button>
  );
}
