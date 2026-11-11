import { callFunction } from './supabase';

type Outcome = 'sent' | 'failed' | 'skipped' | 'already_sent' | 'not_confirmed' | 'not_found';

export type SafeguardingSummary = Partial<Record<Outcome, number>>;

const CHUNK = 50; // must match MAX_IDS in supabase/functions/send-safeguarding

/** Emails the safeguarding form in chunks so each Edge Function call stays short. */
export async function sendSafeguarding(
  ids: string[],
  opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<SafeguardingSummary> {
  const summary: SafeguardingSummary = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await callFunction<{ outcomes: { id: string; outcome: Outcome }[] }>('send-safeguarding', {
      ids: ids.slice(i, i + CHUNK),
      force: opts.force,
    });
    for (const o of res.outcomes) summary[o.outcome] = (summary[o.outcome] ?? 0) + 1;
    opts.onProgress?.(Math.min(i + CHUNK, ids.length), ids.length);
  }
  return summary;
}

export function describeSafeguarding(s: SafeguardingSummary): string {
  const parts: string[] = [];
  if (s.sent) parts.push(`${s.sent} sent`);
  if (s.already_sent) parts.push(`${s.already_sent} already sent (skipped)`);
  if (s.not_confirmed) parts.push(`${s.not_confirmed} skipped (not confirmed)`);
  if (s.skipped) parts.push(`${s.skipped} logged but not sent (email provider not configured)`);
  if (s.not_found) parts.push(`${s.not_found} not found`);
  if (s.failed) parts.push(`${s.failed} failed — press the button again to retry, or see the registrant's email log`);
  return parts.length ? `Safeguarding form: ${parts.join(' · ')}` : 'Nobody to send to';
}
