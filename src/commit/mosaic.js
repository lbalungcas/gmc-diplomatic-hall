/**
 * Lays words out to fill a shape, row by row, like a calligram: the bulb made of everyone's words.
 *
 * `spansAt(y)` returns the [x0, x1] runs inside the shape on row y (0 to 1, top to bottom, with x in
 * the same units as the height). Words are given by their width-to-height ratio. Pure maths, so it
 * can be tested without a browser.
 *
 * The row height is worked out so the words just fill the shape. With very few commitments it stops
 * growing (the shape has to stay recognisable and the words have to look like text), and the words
 * repeat to fill what's left. Those repeats are marked `ghost`.
 */
const GAP = 0.32;           // space between words, in word heights
const LEADING = 1.12;       // row spacing, in word heights
const MIN_ROWS = 15;

/** A repeatable shuffle, so a refreshed screen builds the same bulb. */
export function seededShuffle(n, seed = 7) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function fill(aspects, spansAt, rowH) {
  const slots = [];
  const order = seededShuffle(aspects.length);
  let next = 0;
  const step = rowH * LEADING;
  for (let y = step / 2; y < 1; y += step) {
    for (const [x0, x1] of spansAt(y)) {
      const width = x1 - x0;
      if (width < rowH * 0.8) continue;
      const row = [];
      let used = 0;
      for (;;) {
        const idx = order[next % order.length];
        const w = aspects[idx] * rowH;
        const need = (row.length ? GAP * rowH : 0) + w;
        // A word wider than the whole span still goes in, shrunk to fit: tips of the shape are narrow.
        if (used + need > width && row.length) break;
        row.push({ word: idx, ghost: next >= order.length, w: Math.min(w, width) });
        used += need;
        next++;
        if (used >= width) break;
      }
      // Spread what's left between the words, so each row reaches both edges of the shape.
      const spare = Math.max(0, width - row.reduce((a, r) => a + r.w, 0));
      const gap = row.length > 1 ? spare / (row.length - 1) : 0;
      let x = row.length > 1 ? x0 : x0 + spare / 2;
      for (const r of row) {
        const size = r.w < aspects[r.word] * rowH ? r.w / aspects[r.word] : rowH;
        slots.push({ word: r.word, ghost: r.ghost, x: x + r.w / 2, y, size });
        x += r.w + gap;
      }
    }
  }
  return { slots, placed: Math.min(next, order.length) };
}

/**
 * @param {number[]} aspects  width / height of each word
 * @param {function} spansAt  (y) => [[x0, x1], ...]
 * @param {number}   area     area of the shape, as a fraction of its 1 x 1 box
 * @returns {{ slots: {word, ghost, x, y, size}[], rowH: number }}
 */
export function layoutMosaic(aspects, spansAt, area) {
  if (!aspects.length) return { slots: [], rowH: 1 / MIN_ROWS };
  const total = aspects.reduce((a, w) => a + w + GAP, 0);
  let rowH = Math.min(1 / MIN_ROWS, Math.sqrt(area / (total * LEADING)));
  // Every word must be in the bulb: that is the whole idea. Shrink until they all fit.
  for (let i = 0; i < 40; i++) {
    const { slots, placed } = fill(aspects, spansAt, rowH);
    if (placed >= aspects.length) return { slots, rowH };
    rowH *= 0.96;
  }
  return { slots: fill(aspects, spansAt, rowH).slots, rowH };
}
