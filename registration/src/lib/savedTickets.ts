// Tickets opened on this phone, so the exit poster can check the guest out with one tap.
// localStorage can throw (private mode, storage full), so every access is guarded.

const TICKETS_KEY = 'yim.tickets';
const CODE_KEY = 'yim.checkoutCode';
const MAX_TICKETS = 5;
/** How long after scanning the exit poster the ticket page offers "Check out now". */
const CODE_TTL_MS = 30 * 60 * 1000;

export interface SavedTicket {
  token: string;
  name: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the guest can still open their ticket link from the email.
  }
}

export function savedTickets(): SavedTicket[] {
  const list = read<SavedTicket[]>(TICKETS_KEY);
  return Array.isArray(list) ? list.filter((t) => typeof t?.token === 'string' && typeof t?.name === 'string') : [];
}

export function saveTicket(token: string, name: string) {
  write(TICKETS_KEY, [{ token, name }, ...savedTickets().filter((t) => t.token !== token)].slice(0, MAX_TICKETS));
}

export function forgetTicket(token: string) {
  write(TICKETS_KEY, savedTickets().filter((t) => t.token !== token));
}

export function rememberCheckoutCode(code: string) {
  write(CODE_KEY, { code, at: Date.now() });
}

export function pendingCheckoutCode(): string | null {
  const v = read<{ code: string; at: number }>(CODE_KEY);
  return v && typeof v.code === 'string' && Date.now() - v.at < CODE_TTL_MS ? v.code : null;
}

export function clearCheckoutCode() {
  write(CODE_KEY, null);
}
