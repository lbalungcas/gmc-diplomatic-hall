import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import type { EventRow } from './db.ts';

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 text escaping and 75-octet line folding.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');

export function buildIcs(event: EventRow, registrationId: string, ticketLink: string): string {
  const location = [event.venue, event.venue_address].filter(Boolean).join(', ');
  const description = [
    event.subtitle,
    `Your ticket: ${ticketLink}`,
    event.arrival_note,
    `Questions: ${event.contact_email}`,
  ].filter(Boolean).join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Youth Innovations Marketplace//Registration//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${registrationId}@youthinnovationsmarketplace.org`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.starts_at)}`,
    `DTEND:${stamp(event.ends_at)}`,
    `SUMMARY:${esc(event.name)}`,
    `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(description)}`,
    `URL:${ticketLink}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const icsBase64 = (ics: string) => encodeBase64(new TextEncoder().encode(ics));
