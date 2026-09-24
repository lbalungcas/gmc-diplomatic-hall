/**
 * Adaptive quality governor.
 *
 * The venue previously had exactly one quality decision, taken once at start-up from
 * `navigator.hardwareConcurrency` and the pointer type. That is a poor proxy: a four-core
 * laptop with a discrete GPU was treated as low-power, while a high-core-count phone with a
 * weak GPU got the full post-processing chain and fourteen point lights.
 *
 * This measures what the device actually delivers and steps quality down — then back up — in
 * the order that costs the least visually per millisecond recovered:
 *
 *   1. pixel ratio   — the cheapest large win; the scene is fill-rate bound, not vertex bound
 *   2. shadows       — one spot light's shadow map
 *   3. post chain    — SMAA and the vignette
 *
 * Steps are deliberately sticky: quality only drops after a sustained bad patch and only
 * recovers after a longer good one, so a single stall while a texture uploads cannot start an
 * oscillation between levels.
 */

const WINDOW_MS = 1500;      // how long a verdict has to hold before acting
const RECOVER_MS = 6000;     // recovery is slower than degradation, to avoid hunting
const BAD_RATIO = 1.25;      // frame time this far over budget counts as "struggling"
const GOOD_RATIO = 0.70;     // and this far under counts as "comfortable"

export function createAdaptiveQuality(renderer, composer, {
  targetFps = 60,
  maxPixelRatio = 2,
  minPixelRatio = 0.75,
  onChange = null,
} = {}) {
  const budgetMs = 1000 / targetFps;

  // Level 0 is full quality; each step up disables one more thing.
  const levels = [
    { pixelRatio: maxPixelRatio, shadows: true, post: true, label: 'full' },
    { pixelRatio: Math.max(minPixelRatio, maxPixelRatio * 0.75), shadows: true, post: true, label: 'reduced resolution' },
    { pixelRatio: Math.max(minPixelRatio, maxPixelRatio * 0.6), shadows: false, post: true, label: 'no shadows' },
    { pixelRatio: minPixelRatio, shadows: false, post: false, label: 'minimum' },
  ];

  let level = 0;
  let badSince = 0;
  let goodSince = 0;
  let locked = false;

  function apply() {
    const cfg = levels[level];
    renderer.setPixelRatio(cfg.pixelRatio);
    if (composer) composer.setPixelRatio?.(cfg.pixelRatio);

    if (renderer.shadowMap.enabled !== cfg.shadows) {
      renderer.shadowMap.enabled = cfg.shadows;
      // The hall's shadow map is only rendered on demand (autoUpdate is off), so turning
      // shadows back on has to explicitly ask for one more render.
      renderer.shadowMap.needsUpdate = cfg.shadows;
    }
    if (onChange) onChange(cfg, level);
  }

  return {
    get level() { return level; },
    get label() { return levels[level].label; },

    /** True when the composer should be used this frame. */
    get usePost() { return levels[level].post; },

    /** Pin the current level — used by the debug overlay and by tests. */
    lock(on = true) { locked = on; },

    /**
     * Jump to a level and pin it. The screenshot harness uses this: it runs on a software
     * renderer, where the governor correctly concludes the device is slow and drops quality,
     * which would make before/after captures incomparable.
     */
    forceLevel(n) {
      level = Math.max(0, Math.min(levels.length - 1, n));
      locked = true;
      apply();
    },

    /** Feed one frame's wall-clock duration, in milliseconds. */
    sample(frameMs, now) {
      if (locked) return;

      if (frameMs > budgetMs * BAD_RATIO) {
        goodSince = 0;
        if (!badSince) badSince = now;
        else if (now - badSince > WINDOW_MS && level < levels.length - 1) {
          level++;
          badSince = 0;
          apply();
        }
      } else if (frameMs < budgetMs * GOOD_RATIO) {
        badSince = 0;
        if (!goodSince) goodSince = now;
        else if (now - goodSince > RECOVER_MS && level > 0) {
          level--;
          goodSince = 0;
          apply();
        }
      } else {
        badSince = 0;
        goodSince = 0;
      }
    },
  };
}
