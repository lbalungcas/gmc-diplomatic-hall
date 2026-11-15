import Papa from 'papaparse';
import { callFunction } from './supabase';
import type { AwardCandidate, AwardKind, AwardVote, AwardVoter } from './types';

/** The Deal Corner thematic tracks (deal-corner/experts.js on the main site). */
export const TRACKS = [
  'Child Exploitation and Labour',
  'Child, Early, and Forced Marriage',
  'Corporal Punishment',
  'Climate Change & Child Rights',
  'Adolescent Sexual and Reproductive Health',
  'Online Child Sexual Exploitation and Abuse',
  'Child Protection (CANE+D)',
] as const;

export const NOTE_MAX = 500;

export const AWARD_LABEL: Record<AwardKind, string> = {
  mpyi: 'Most Promising Young Innovator',
  peoples_choice: "People's Choice of Innovation",
};

type SendOutcome = 'sent' | 'failed' | 'skipped' | 'already_sent' | 'already_voted' | 'not_found';

const CHUNK = 50; // must match MAX_IDS in supabase/functions/send-ballots

/** Sends ballot (or reminder) emails in chunks so each Edge Function call stays short. */
export async function sendBallots(
  awardId: string,
  ids: string[],
  opts: { reminder?: boolean; force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<Partial<Record<SendOutcome, number>>> {
  const counts: Partial<Record<SendOutcome, number>> = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await callFunction<{ outcomes: { id: string; outcome: SendOutcome }[] }>('send-ballots', {
      award_id: awardId,
      ids: ids.slice(i, i + CHUNK),
      reminder: opts.reminder,
      force: opts.force,
    });
    for (const o of res.outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
    opts.onProgress?.(Math.min(i + CHUNK, ids.length), ids.length);
  }
  return counts;
}

export function describeSend(c: Partial<Record<SendOutcome, number>>, reminder = false): string {
  const parts: string[] = [];
  if (c.sent) parts.push(`${c.sent} ${reminder ? 'reminder(s)' : 'ballot(s)'} sent`);
  if (c.skipped) parts.push(`${c.skipped} logged only (email not configured)`);
  if (c.already_sent) parts.push(`${c.already_sent} already had a ballot`);
  if (c.already_voted) parts.push(`${c.already_voted} already voted`);
  if (c.failed) parts.push(`${c.failed} failed — try again`);
  if (c.not_found) parts.push(`${c.not_found} not found`);
  return parts.join(' · ') || 'Nothing to send';
}

export interface RosterRow {
  name: string;
  email: string;
  team: string;
  track: string;
}

const pick = (row: Record<string, string>, ...keys: string[]) => {
  const found = Object.keys(row).find((k) => keys.includes(k.trim().toLowerCase()));
  return found ? (row[found] ?? '').trim() : '';
};

/** Reads a roster CSV with columns like Name, Email, Team, Track (header names are matched loosely). */
export function parseRoster(text: string): RosterRow[] {
  const { data } = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
  return data
    .map((r) => ({
      name: pick(r, 'name', 'full name', 'full_name', 'innovator'),
      email: pick(r, 'email', 'email address', 'e-mail'),
      team: pick(r, 'team', 'team name', 'organisation', 'organization', 'innovation', 'booth'),
      track: pick(r, 'track', 'thematic track', 'theme'),
    }))
    .filter((r) => r.name || r.email);
}

const safe = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** One row per vote, plus who hasn't voted, for the record after the event. */
export function votesToCsv(kind: AwardKind, votes: AwardVote[], voters: AwardVoter[], candidates: AwardCandidate[]): string {
  const cand = new Map(candidates.map((c) => [c.id, c]));
  const voterById = new Map(voters.map((v) => [v.id, v]));
  const choice = (id: string) => {
    const c = cand.get(id);
    if (!c) return '';
    return kind === 'peoples_choice' && c.booth_no ? `Booth ${c.booth_no}: ${c.label}` : c.label;
  };
  const header = kind === 'mpyi'
    ? ['Voted at', 'Voter name', 'Voter team', 'Voter track', 'Voter email', 'Voted for', 'Their team', 'Note']
    : ['Voted at', 'Voter name', 'Voter email', 'Booth', 'Note'];
  const rows = votes.map((v) => {
    const email = voterById.get(v.voter_id)?.email ?? '';
    return kind === 'mpyi'
      ? [v.created_at, v.voter_name, v.voter_team, v.voter_track, email, choice(v.candidate_id), cand.get(v.candidate_id)?.team, v.note]
      : [v.created_at, v.voter_name, email, choice(v.candidate_id), v.note];
  });
  return Papa.unparse({ fields: header, data: rows.map((r) => r.map(safe)) });
}
