import type { AwardKind } from './types';

export const STATUSES = ['pending', 'approved', 'declined', 'waitlisted', 'cancelled'] as const;

export const EVENT_SLUG = import.meta.env.VITE_EVENT_SLUG || 'yim-2026';

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
