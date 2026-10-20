import { callFunction } from './supabase';

export type Decision = 'approved' | 'declined' | 'waitlisted' | 'pending';
type Outcome = 'updated' | 'unchanged' | 'over_capacity' | 'needs_guardian' | 'checked_in' | 'not_found';

export interface DecideSummary {
  counts: Partial<Record<Outcome, number>>;
  overCapacityIds: string[];
  emailFailures: number;
}

const CHUNK = 50; // must match MAX_IDS in supabase/functions/decide

/** Runs a (bulk) decision in chunks so each Edge Function call stays short. */
export async function decide(
  ids: string[],
  decision: Decision,
  opts: { reason?: string; force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<DecideSummary> {
  const summary: DecideSummary = { counts: {}, overCapacityIds: [], emailFailures: 0 };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await callFunction<{ outcomes: { id: string; outcome: Outcome }[]; emails: Record<string, string> }>('decide', {
      ids: chunk,
      decision,
      reason: opts.reason,
      force: opts.force,
    });
    for (const o of res.outcomes) {
      summary.counts[o.outcome] = (summary.counts[o.outcome] ?? 0) + 1;
      if (o.outcome === 'over_capacity') summary.overCapacityIds.push(o.id);
    }
    summary.emailFailures += Object.values(res.emails).filter((s) => s === 'failed').length;
    opts.onProgress?.(Math.min(i + CHUNK, ids.length), ids.length);
  }
  return summary;
}

const VERB: Record<Decision, string> = { approved: 'approved', declined: 'declined', waitlisted: 'waitlisted', pending: 'moved to pending' };

export function describeSummary(s: DecideSummary, decision: Decision): string {
  const parts: string[] = [];
  if (s.counts.updated) parts.push(`${s.counts.updated} ${VERB[decision]}`);
  if (s.counts.unchanged) parts.push(`${s.counts.unchanged} already ${VERB[decision]}`);
  if (s.counts.over_capacity) parts.push(`${s.counts.over_capacity} not approved — event is at capacity`);
  if (s.counts.needs_guardian) parts.push(`${s.counts.needs_guardian} not approved — under 18 without parent/guardian consent (record it in their details first)`);
  if (s.counts.checked_in) parts.push(`${s.counts.checked_in} skipped (already checked in)`);
  if (s.emailFailures) parts.push(`${s.emailFailures} email(s) failed — see the registrant's email log`);
  return parts.join(' · ') || 'Nothing changed';
}
