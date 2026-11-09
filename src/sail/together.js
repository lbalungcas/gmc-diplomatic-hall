/**
 * The two-part opening ("together" mode): the words on screen, the finale's timing, and the
 * partners' billboard. The rules are in raceHub.js; this is what the room sees.
 *
 *   race       the first boat to the lighthouse wins...
 *   challenge  "Can <boat> change the world alone?"
 *   energy     "No one can. Let's light it together." Every phone taps to light the lighthouse
 *   opening    the bulb rises out of the lit lighthouse, rays burst, the logo: IS NOW OPEN!
 *              (src/sail/opening.js). Then the organizers' and supporters' logos.
 */
export const LINES = {
  first: (name) => `${name} reached the lighthouse first!`,
  challenge: (name) => `Can ${name} change the world alone?`,
  together: 'No one can. Let’s light it together.',
  tap: 'Tap your phone to light the lighthouse!',
  phoneDone: 'You are part of the solution.',
  phoneWelcome: 'Welcome to the Youth Innovations Marketplace.',
};

/** When the challenge's first line gives way to the question, in seconds from `challengeAt`. */
export const CHALLENGE_ASK = 3.2;

/** When the partners' billboard rises, in seconds from `openAt`: after IS NOW OPEN! has landed. */
export const BILLBOARD_AT = 12.5;

const PARTNERS = [
  { row: 0, src: 'violence-ends-with-us', alt: 'Violence Ends With Us' },
  { row: 0, src: 'kindernothilfe', alt: 'Kindernothilfe' },
  { row: 0, src: 'terre-des-hommes', alt: 'Terre des Hommes Netherlands' },
  { row: 1, src: 'supported-by', alt: 'Supported by' },
  { row: 2, src: 'german-cooperation', alt: 'German Cooperation' },
  { row: 2, src: 'european-union', alt: 'Co-funded by the European Union' },
];

/**
 * The billboard: a white card that rises under the logo, the partners' logos arriving one by one.
 * Driven by `t`, seconds since it began, so a refreshed screen shows the same thing.
 */
export function createBillboard(parent) {
  const card = document.createElement('div');
  card.className = 'billboard hidden';
  const rows = [0, 1, 2].map(() => {
    const r = document.createElement('div');
    r.className = 'billboard-row';
    card.append(r);
    return r;
  });
  rows[1].classList.add('small');
  const imgs = PARTNERS.map((p) => {
    const img = new Image();
    img.src = `/sail/partners/${p.src}.png`;
    img.alt = p.alt;
    img.decoding = 'async';
    rows[p.row].append(img);
    return img;
  });
  parent.append(card);
  return {
    update(t) {
      card.classList.toggle('hidden', t < 0);
      if (t < 0) return;
      const k = Math.min(1, t / 0.7);
      card.style.opacity = String(k);
      card.style.transform = `translate(-50%, ${(1 - k) * 30}%)`;
      imgs.forEach((img, i) => {
        const a = Math.max(0, Math.min(1, (t - 0.5 - i * 0.35) / 0.45));
        img.style.opacity = String(a);
        img.style.transform = `scale(${0.85 + a * 0.15})`;
      });
    },
  };
}
