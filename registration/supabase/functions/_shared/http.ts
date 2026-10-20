import { APP_URL } from './constants.ts';

// Browsers may call these functions only from the site hosting the registration app (plus localhost in dev).
const APP_ORIGIN = new URL(APP_URL).origin;
const allowedOrigins = new Set(
  [APP_ORIGIN, ...(Deno.env.get('EXTRA_ALLOWED_ORIGINS') ?? '').split(',')]
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : APP_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Wraps a POST handler with CORS preflight, JSON parsing and uniform error responses. */
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
    try {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        throw new HttpError(400, 'Invalid JSON body');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid JSON body');
      return json(req, await handler(req, body));
    } catch (err) {
      if (err instanceof HttpError) return json(req, { error: err.message, details: err.details }, err.status);
      console.error(err);
      return json(req, { error: 'Something went wrong. Please try again.' }, 500);
    }
  });
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  );
}
