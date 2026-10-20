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
