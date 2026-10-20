import type { STATUSES } from './constants';

export type Status = (typeof STATUSES)[number];

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  venue: string;
  venue_address: string | null;
  map_url: string | null;
  contact_email: string;
  arrival_note: string | null;
  capacity: number;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  auto_waitlist: boolean;
  form_schema: unknown;
}

export interface Registration {
  id: string;
  event_id: string;
  ticket_token: string;
  status: Status;
  source: 'form' | 'import' | 'seed';
  full_name: string;
  preferred_name: string | null;
  email: string;
  phone: string | null;
  organization: string | null;
  category: string | null;
  country: string | null;
  nationality: string | null;
  age: number | null;
  age_group: 'under-18' | '18-24' | '25+' | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_consent: boolean;
  photo_consent: boolean;
  privacy_consent: boolean;
  answers: Record<string, string | string[]>;
  decline_reason: string | null;
  created_at: string;
  decided_at: string | null;
  checked_in_at: string | null;
}

export interface CategoryStats {
  category: string;
  total: number;
  pending: number;
  approved: number;
  declined: number;
  waitlisted: number;
  checked_in: number;
}

export interface EventStats {
  capacity: number;
  total: number;
  pending: number;
  approved: number;
  declined: number;
  waitlisted: number;
  cancelled: number;
  checked_in: number;
  remaining: number;
  by_category: CategoryStats[];
}

export type CheckInResult =
  | { result: 'invalid' }
  | {
      result: 'checked_in' | 'already_checked_in' | 'not_approved';
      registration_id: string;
      event_id: string;
      full_name: string;
      preferred_name: string | null;
      organization: string | null;
      category: string | null;
      status: Status;
      photo_consent: boolean;
      checked_in_at: string | null;
    };

export interface Ticket {
  full_name: string;
  preferred_name: string | null;
  organization: string | null;
  category: string | null;
  status: Status;
  checked_in_at: string | null;
  decline_reason: string | null;
  event: Pick<EventRow, 'name' | 'subtitle' | 'starts_at' | 'ends_at' | 'timezone' | 'venue' | 'venue_address' | 'map_url' | 'contact_email' | 'arrival_note'>;
}
