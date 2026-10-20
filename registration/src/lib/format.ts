const TZ = 'Asia/Manila';

export function formatEventDate(startIso: string, endIso: string, timeZone = TZ) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(startIso));
  const t = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  return { date, time: `${t(startIso)} – ${t(endIso)}` };
}

export function formatDateTime(iso: string | null | undefined, timeZone = TZ) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, timeZone = TZ) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export const ageLabel = (age: number | null, group?: string | null) =>
  age !== null ? `${age}${age < 18 ? ' (under 18)' : ''}` : group === 'under-18' ? 'Under 18' : group ?? '—';

/** iCalendar file for "Add to calendar" on the ticket page. */
export function buildIcs(e: { name: string; subtitle: string | null; starts_at: string; ends_at: string; venue: string; venue_address: string | null }, url: string) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Youth Innovations Marketplace//Registration//EN', 'BEGIN:VEVENT',
    `UID:${stamp(e.starts_at)}-yim@youthinnovationsmarketplace.org`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(e.ends_at)}`,
    `SUMMARY:${esc(e.name)}`,
    `LOCATION:${esc([e.venue, e.venue_address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc(`${e.subtitle ?? ''}\nYour ticket: ${url}`)}`,
    `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
