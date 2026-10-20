export const EVENT_SLUG = Deno.env.get('EVENT_SLUG') ?? 'yim-2026';

/** Where the registration app lives, e.g. https://youthinnovationsmarketplace.org/register (ticket links, email images). */
export const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:5173/register').replace(/\/$/, '');

export const ticketUrl = (token: string) => `${APP_URL}/t/${token}`;
