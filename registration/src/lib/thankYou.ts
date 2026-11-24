import { callFunction, supabase } from './supabase';

type Outcome = 'sent' | 'failed' | 'skipped' | 'already_sent' | 'not_eligible' | 'not_found';
export type ThankYouVariant = 'attended' | 'registered';
export type ThankYouSummary = Partial<Record<Outcome, number>>;

const CHUNK = 50; // must match MAX_IDS in supabase/functions/send-thank-you

/** Statuses that get the thank-you. Declined and cancelled registrations are left out. */
export const THANK_YOU_STATUSES = ['approved', 'pending', 'waitlisted'] as const;

export interface ThankYouAudience {
  /** Registration ids to send to (eligible status, not anonymized). */
  ids: string[];
  /** Distinct email addresses among them. */
  people: number;
  /** Of those addresses, how many checked in on the day. */
  attended: number;
  /** Addresses that already received the thank-you. */
  alreadySent: number;
  /** Registrations left out because they were declined or cancelled. */
  excluded: number;
}

interface Row { id: string; email: string; status: string; checked_in_at: string | null }

/**
 * Works out who a thank-you send reaches: every registration of the event, or just `onlyIds`.
 * Several registrations under one address count (and are emailed) once.
 */
export async function thankYouAudience(eventId: string, onlyIds?: string[]): Promise<ThankYouAudience> {
  const rows: Row[] = [];
  if (onlyIds) {
    for (let i = 0; i < onlyIds.length; i += 200) {
      const { data, error } = await supabase.from('registrations').select('id, email, status, checked_in_at')
        .in('id', onlyIds.slice(i, i + 200)).is('anonymized_at', null);
      if (error) throw error;
      rows.push(...(data as Row[]));
    }
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('registrations').select('id, email, status, checked_in_at')
        .eq('event_id', eventId).is('anonymized_at', null).order('id').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data as Row[]));
      if (!data || data.length < 1000) break;
    }
  }

  const eligible = rows.filter((r) => (THANK_YOU_STATUSES as readonly string[]).includes(r.status));
  const byAddress = new Map<string, boolean>();          // address -> checked in under any registration
  for (const r of eligible) {
    const a = r.email.toLowerCase();
    byAddress.set(a, (byAddress.get(a) ?? false) || !!r.checked_in_at);
  }

  const sent = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('email_log').select('to_email')
      .eq('template', 'thank_you').eq('status', 'sent').order('id').range(from, from + 999);
    if (error) throw error;
    for (const r of data as { to_email: string | null }[]) if (r.to_email) sent.add(r.to_email.toLowerCase());
    if (!data || data.length < 1000) break;
  }

  return {
    ids: eligible.map((r) => r.id),
    people: byAddress.size,
    attended: [...byAddress.values()].filter(Boolean).length,
    alreadySent: [...byAddress.keys()].filter((a) => sent.has(a)).length,
    excluded: rows.length - eligible.length,
  };
}

/** The email as the registrant will see it, for the preview pane. */
export function previewThankYou(eventId: string, variant: ThankYouVariant) {
  return callFunction<{ subject: string; html: string }>('send-thank-you', { event_id: eventId, preview: variant });
}

/** Sends one copy to the signed-in admin. */
export function sendThankYouTest(eventId: string, variant: ThankYouVariant) {
  return callFunction<{ outcome: 'sent' | 'failed' | 'skipped'; to: string; error: string | null }>(
    'send-thank-you', { event_id: eventId, test: true, variant });
}

/** Sends the thank-you in chunks so each Edge Function call stays short. */
export async function sendThankYou(
  ids: string[],
  opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<ThankYouSummary> {
  const summary: ThankYouSummary = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await callFunction<{ outcomes: { id: string; outcome: Outcome }[] }>('send-thank-you', {
      ids: ids.slice(i, i + CHUNK),
      force: opts.force,
    });
    for (const o of res.outcomes) summary[o.outcome] = (summary[o.outcome] ?? 0) + 1;
    opts.onProgress?.(Math.min(i + CHUNK, ids.length), ids.length);
  }
  return summary;
}

export function describeThankYou(s: ThankYouSummary): string {
  const parts: string[] = [];
  if (s.sent) parts.push(`${s.sent} sent`);
  if (s.already_sent) parts.push(`${s.already_sent} skipped (that address already has it)`);
  if (s.not_eligible) parts.push(`${s.not_eligible} skipped (declined or cancelled)`);
  if (s.skipped) parts.push(`${s.skipped} logged but not sent (email provider not configured)`);
  if (s.not_found) parts.push(`${s.not_found} not found`);
  if (s.failed) parts.push(`${s.failed} failed — press Send again to retry, or see the registrant's email log`);
  return parts.length ? `Thank-you email: ${parts.join(' · ')}` : 'Nobody to send to';
}
