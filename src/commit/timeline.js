/**
 * The finale's script, in seconds from the server's `finaleAt`. The wall and every phone read the
 * same numbers on the same clock, which is what makes the room light up at one moment. No 3D in
 * here, so the phone page doesn't have to download any.
 */
export const T = {
  cardsGlow: 3,      // the cards begin to glow
  dissolve: 5,       // and come apart into their words
  flyFrom: 5.6,      // the first words take off
  flyTo: 11,         // the last words take off
  flyDur: 3.5,       // each word's journey, so the bulb is complete at 14.5
  rise: 13.5,        // the swell begins
  flicker: 15.4,     // the finished bulb stutters
  ignite: 16.5,      // and catches: the rays, and every phone in the room
  settle: 22,        // it moves to its place in the logo
  write: 24,         // the logo writes on
  close: 26.5,       // the closing words
};

const plural = (n) => `${n} commitment${n === 1 ? '' : 's'}`;

/** The words on the big screen, in order. Change them here. */
export function captions(n) {
  return [
    { from: 0.6, to: 4.8, text: n ? `Today, you made ${plural(n)}.` : 'Today, we made a commitment.' },
    { from: 5.4, to: 9.8, text: 'Each one is a light.' },
    { from: 10.4, to: 15.2, text: 'Together, they made this marketplace.' },
  ];
}

export function closingLines(n) {
  return {
    line1: 'has come to a close.',
    line2: n ? `${plural(n)}. One light. Thank you.` : 'One light. Thank you.',
  };
}
