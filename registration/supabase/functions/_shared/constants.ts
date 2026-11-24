export const EVENT_SLUG = Deno.env.get('EVENT_SLUG') ?? 'yim-2026';

/** Where the registration app lives, e.g. https://youthinnovationsmarketplace.org/register (ticket links, email images). */
export const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:5173/register').replace(/\/$/, '');

export const ticketUrl = (token: string) => `${APP_URL}/t/${token}`;

/** A voter's personal awards ballot. */
export const ballotUrl = (token: string) => `${APP_URL}/vote/${token}`;

/** The main site the registration app is part of, e.g. https://youthinnovationsmarketplace.org */
export const SITE_URL = (Deno.env.get('SITE_URL') ?? new URL(APP_URL).origin).replace(/\/$/, '');

/** The Digital Marketplace: the 3D hall with all 24 youth booths, open after the event too. */
export const DIGITAL_MARKETPLACE_URL = Deno.env.get('DIGITAL_MARKETPLACE_URL') ?? `${SITE_URL}/game/`;

/** Where people interested in a specific booth write to, to explore partnerships. */
export const PARTNERSHIP_EMAIL = Deno.env.get('PARTNERSHIP_EMAIL') ?? 'violenceendswithus@gmail.com';

/** The three co-organizers, as credited in the thank-you email. */
export const ORGANIZERS = [
  {
    name: 'Violence Ends With Us (VEWU)',
    blurb: 'A youth-led movement turning young people\'s ideas into action for a violence-free future.',
    url: 'https://violenceendswithus.com/',
  },
  {
    name: 'Kindernothilfe (KNH)',
    blurb: 'Working with local partners since 1959 to protect children and advance their rights.',
    url: 'https://www.kindernothilfe.org/en/',
  },
  {
    name: 'Terre des Hommes Netherlands (TdH NL)',
    blurb: 'Working to prevent and stop child exploitation, with partners around the world.',
    url: 'https://www.terredeshommes.nl/en',
  },
] as const;

/** The conference's Child Safeguarding and Code of Conduct Google Form, required for every attendee. */
export const SAFEGUARDING_FORM_URL = Deno.env.get('SAFEGUARDING_FORM_URL') ??
  'https://docs.google.com/forms/d/e/1FAIpQLScDynJbLTLSNyJ6u_remlMxpKeLsSBpBZR-sauwv2ll-w1how/viewform';
