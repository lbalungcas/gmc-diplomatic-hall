import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

/** Service-role client. Bypasses RLS — only ever used inside Edge Functions. */
export const db: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export interface Staff {
  userId: string;
  email: string;
  role: 'admin' | 'scanner';
}

/**
 * Server-side role check. The functions are deployed with verify_jwt = false (needed for the
 * new publishable API keys), so every privileged function must call this itself.
 */
export async function requireAdmin(req: Request): Promise<Staff> {
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'Not signed in');
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Not signed in');

  const { data: staff } = await db
    .from('admin_users')
    .select('email, role, active')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (!staff?.active || staff.role !== 'admin') throw new HttpError(403, 'Admins only');
  return { userId: data.user.id, email: staff.email, role: staff.role };
}

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
}

export interface RegistrationRow {
  id: string;
  event_id: string;
  ticket_token: string;
  status: 'pending' | 'approved' | 'declined' | 'waitlisted' | 'cancelled';
  full_name: string;
  preferred_name: string | null;
  email: string;
  organization: string | null;
  category: string | null;
  decline_reason: string | null;
  anonymized_at: string | null;
}

export async function loadRegistrations(ids: string[]): Promise<RegistrationRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from('registrations')
    .select('id, event_id, ticket_token, status, full_name, preferred_name, email, organization, category, decline_reason, anonymized_at')
    .in('id', ids);
  if (error) throw error;
  return data as RegistrationRow[];
}

export async function loadEvent(id: string): Promise<EventRow> {
  const { data, error } = await db.from('events').select('*').eq('id', id).single();
  if (error) throw error;
  return data as EventRow;
}
