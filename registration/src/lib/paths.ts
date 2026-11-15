/** The app is served under /register/ on the main site (vite.config.ts `base`). Ends with a slash. */
export const BASE = import.meta.env.BASE_URL;

/** URL for a file in public/, e.g. publicUrl('brand/logo.png') → /register/brand/logo.png */
export const publicUrl = (path: string) => BASE + path.replace(/^\//, '');

/**
 * Form option images: a full URL is used as-is; a site path such as /form/deal-corner.png is
 * relative to the registration app, so it gets the /register prefix.
 */
export const imageUrl = (src: string) => (/^(https?:)?\/\//.test(src) || src.startsWith(BASE) ? src : publicUrl(src));

/** Absolute link to a registrant's ticket page. */
export const ticketLink = (token: string) => `${window.location.origin}${BASE}t/${token}`;

/** Absolute link for the check-out poster at the exit. */
export const checkoutLink = (code: string) => `${window.location.origin}${BASE}checkout/${code}`;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** Ticket QR codes hold https://<domain>/register/t/<token>; also accept a bare token typed in by hand. */
export function ticketTokenFrom(raw: string): string | null {
  const s = raw.trim();
  if (TOKEN_RE.test(s)) return s;
  try {
    const m = new URL(s).pathname.match(/\/t\/([A-Za-z0-9_-]{20,100})\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
