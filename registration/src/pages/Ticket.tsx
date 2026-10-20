import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';
import { buildIcs, formatDateTime, formatEventDate } from '../lib/format';
import { ticketLink } from '../lib/paths';
import { supabase } from '../lib/supabase';
import type { Ticket as TicketData } from '../lib/types';

const STATUS_COPY = {
  pending: {
    title: 'Your registration is under review',
    body: "The organizers are reviewing registrations. You'll receive an email with your QR ticket once you're approved.",
    tone: 'border-amber-300 bg-amber-50 text-amber-950',
  },
  waitlisted: {
    title: "You're on the waitlist",
    body: "The event is currently full. If a place opens up and you're approved, we'll email you your QR ticket. Please don't come to the venue without one.",
    tone: 'border-sky-300 bg-sky-50 text-sky-950',
  },
  declined: {
    title: "We couldn't confirm your registration",
    body: "Unfortunately we're unable to confirm your attendance this time.",
    tone: 'border-red-300 bg-red-50 text-red-950',
  },
  cancelled: {
    title: 'This registration was cancelled',
    body: 'If you think this is a mistake, please contact the organizers.',
    tone: 'border-slate-300 bg-slate-50 text-slate-900',
  },
} as const;

export default function Ticket() {
  const { token = '' } = useParams();
  const location = useLocation();
  const justRegistered = (location.state as { justRegistered?: boolean } | null)?.justRegistered;
  const [ticket, setTicket] = useState<TicketData | null | undefined>(undefined);

  useEffect(() => {
    supabase.rpc('get_ticket', { p_token: token }).then(({ data, error }) => setTicket(error ? null : (data as TicketData | null)));
  }, [token]);

  if (ticket === undefined) {
    return <PublicShell><p className="py-20 text-center text-slate-500">Loading your ticket…</p></PublicShell>;
  }

  if (ticket === null) {
    return (
      <PublicShell>
        <div className="card p-6 text-center">
          <h1 className="text-2xl font-bold">Ticket not found</h1>
          <p className="mt-2">This link is invalid or has expired. Please use the link from your most recent email.</p>
          <Link to="/" className="btn-primary mt-5">Go to registration</Link>
        </div>
      </PublicShell>
    );
  }

  const { event } = ticket;
  const when = formatEventDate(event.starts_at, event.ends_at, event.timezone);
  const ticketUrl = ticketLink(token!);
  const approved = ticket.status === 'approved';
  const copy = ticket.status === 'approved' ? null : STATUS_COPY[ticket.status];

  function downloadIcs() {
    const blob = new Blob([buildIcs(event, ticketUrl)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'youth-innovations-marketplace.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <PublicShell>
      {justRegistered && (
        <div role="status" className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
          <h2 className="text-lg font-bold text-emerald-900">Thank you — registration received!</h2>
          <p className="mt-1">
            We've sent a confirmation email. Bookmark this page to check your status at any time.
          </p>
        </div>
      )}

      <article className="card overflow-hidden">
        <div className="bg-navy px-6 py-5 text-white">
          <p className="text-xs font-semibold tracking-widest text-sun uppercase">Your ticket</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">{ticket.full_name}</h1>
          {ticket.organization && <p className="text-white/80">{ticket.organization}</p>}
          <p className="mt-1 text-sm text-white/70">{ticket.category}</p>
        </div>
        <div className="h-1 bg-sun" aria-hidden="true" />

        <div className="space-y-6 p-6">
          {ticket.checked_in_at ? (
            <div className="rounded-xl border border-navy/30 bg-navy-surface p-4 text-navy">
              <p className="text-lg font-bold">Checked in ✓</p>
              <p className="text-sm">Welcome! You checked in at {formatDateTime(ticket.checked_in_at, event.timezone)}.</p>
            </div>
          ) : approved ? (
            <div className="text-center">
              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900 ring-1 ring-emerald-300">
                Confirmed
              </span>
              <div className="mx-auto mt-4 w-fit rounded-2xl border-2 border-slate-200 bg-white p-4">
                <QRCodeSVG value={ticketUrl} size={240} level="M" fgColor="#0f2240" marginSize={0} title="Your QR ticket" />
              </div>
              <p className="mt-3 text-sm text-slate-600">Show this code at the registration desk. Please don't share it.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={downloadIcs} className="btn-sun">Add to calendar</button>
                <button type="button" onClick={() => window.print()} className="btn-ghost">Print ticket</button>
              </div>
            </div>
          ) : copy && (
            <div className={`rounded-xl border p-4 ${copy.tone}`}>
              <p className="text-lg font-bold">{copy.title}</p>
              <p className="mt-1 text-sm">{copy.body}</p>
              {ticket.status === 'declined' && ticket.decline_reason && (
                <p className="mt-2 text-sm"><strong>Note from the organizers:</strong> {ticket.decline_reason}</p>
              )}
            </div>
          )}

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-navy">Event</dt>
              <dd>{event.name}<br /><span className="text-slate-500">{event.subtitle}</span></dd>
            </div>
            <div>
              <dt className="font-semibold text-navy">When</dt>
              <dd>{when.date}<br />{when.time} (Manila time)</dd>
            </div>
            <div>
              <dt className="font-semibold text-navy">Where</dt>
              <dd>
                {event.venue}
                {event.venue_address && <><br />{event.venue_address}</>}
                {event.map_url && <><br /><a className="font-semibold text-navy underline" href={event.map_url} target="_blank" rel="noreferrer">Open in Maps</a></>}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-navy">Questions?</dt>
              <dd><a className="font-semibold text-navy underline" href={`mailto:${event.contact_email}`}>{event.contact_email}</a></dd>
            </div>
          </dl>
          {approved && event.arrival_note && <p className="rounded-xl bg-sun-light p-4 text-sm text-slate-800">{event.arrival_note}</p>}
        </div>
      </article>
    </PublicShell>
  );
}
