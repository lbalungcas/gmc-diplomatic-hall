export const EVENT_SLUG = Deno.env.get('EVENT_SLUG') ?? 'yim-2026';

/** Where the registration app lives, e.g. https://youthinnovationsmarketplace.org/register (ticket links, email images). */
export const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:5173/register').replace(/\/$/, '');

export const ticketUrl = (token: string) => `${APP_URL}/t/${token}`;

/** The conference's Child Safeguarding and Code of Conduct Google Form, required for every attendee. */
export const SAFEGUARDING_FORM_URL = Deno.env.get('SAFEGUARDING_FORM_URL') ??
  'https://docs.google.com/forms/d/e/1FAIpQLScDynJbLTLSNyJ6u_remlMxpKeLsSBpBZR-sauwv2ll-w1how/viewform';
