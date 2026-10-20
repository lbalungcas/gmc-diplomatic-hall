import { createClient } from '@supabase/supabase-js';
import { FunctionsHttpError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — see .env.example');
}

// Read before createClient: the client strips the #access_token…&type=… fragment from invite and
// password-reset links once it has signed the user in.
const hash = new URLSearchParams(window.location.hash.slice(1));
/** 'invite' or 'recovery' when this page was opened from a Supabase auth email. */
export const authLinkType = hash.get('type');
/** Set when an auth email link was expired or already used. */
export const authLinkError = hash.get('error_description');

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export class ApiError extends Error {
  constructor(message: string, public status?: number, public details?: unknown) {
    super(message);
  }
}

/** Calls an Edge Function and surfaces its `{ error, details }` body as an ApiError. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      let payload: { error?: string; details?: unknown } = {};
      try {
        payload = await res.json();
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(payload.error ?? `Request failed (${res.status})`, res.status, payload.details);
    }
    throw new ApiError('Network error — check your connection and try again.');
  }
  return data as T;
}
