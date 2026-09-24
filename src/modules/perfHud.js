/**
 * Dev-only performance overlay. Enabled with `?stats=1` (or `localStorage.perfHud = '1'`).
 *
 * Exists so the visual overhaul can be measured rather than eyeballed: draw calls and triangle
 * count are the numbers that move when materials are deduped in Blender, and the frame-time
 * percentiles are what the adaptive quality governor reacts to.
 */

const SAMPLE_WINDOW = 120; // ~2s at 60fps

export function isPerfHudEnabled() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('stats')) return q.get('stats') !== '0';
    return localStorage.getItem('perfHud') === '1';
  } catch (e) {
    return false;
  }
}

export function createPerfHud(renderer) {
  // With EffectComposer the scene is drawn into a render target and then several full-screen
  // passes run on top. `renderer.info` auto-resets at the start of every `render()` call, so by
  // the time the frame is on screen it only describes the last pass (1 call, 2 tris). Take manual
  // control and reset once per frame so the numbers describe the whole frame.
  renderer.info.autoReset = false;

  const el = document.createElement('div');
  el.id = 'perf-hud';
  Object.assign(el.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    zIndex: '9999',
    padding: '8px 10px',
    font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: '#cfe9ff',
    background: 'rgba(4, 8, 16, 0.82)',
    border: '1px solid rgba(0, 212, 255, 0.35)',
    borderRadius: '8px',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
  });
  document.body.appendChild(el);

  const frames = new Float32Array(SAMPLE_WINDOW);
  let frameIdx = 0;
  let frameCount = 0;
  let accum = 0;
  const sorted = new Float32Array(SAMPLE_WINDOW);

  /** Highest-recorded values, so a spike while turning a corner is still visible after the fact. */
  let peakCalls = 0;
  let peakTris = 0;

  let lastFrameStart = 0;

  return {
    el,

    /**
     * Call at the very top of the frame, before any rendering, so `renderer.info` accumulates
     * across every composer pass instead of being clobbered by the last one.
     */
    beginFrame() {
      renderer.info.reset();
    },

    /**
     * Call once per rendered frame, after the render. Measures wall-clock frame time itself
     * rather than taking the loop's delta, which is clamped to 100ms and would hide real stalls.
     */
    update() {
      const now = performance.now();
      const deltaMs = lastFrameStart ? now - lastFrameStart : 16.7;
      lastFrameStart = now;

      frames[frameIdx] = deltaMs;
      frameIdx = (frameIdx + 1) % SAMPLE_WINDOW;
      if (frameCount < SAMPLE_WINDOW) frameCount++;

      accum += deltaMs;
      if (accum < 250) return; // refresh the text ~4x/s; reading it any faster is noise
      accum = 0;

      sorted.set(frames.subarray(0, frameCount));
      const view = sorted.subarray(0, frameCount);
      Array.prototype.sort.call(view, (a, b) => a - b);
      const avg = view.reduce((s, v) => s + v, 0) / frameCount;
      const p95 = view[Math.min(frameCount - 1, Math.floor(frameCount * 0.95))];
      const worst = view[frameCount - 1];

      const info = renderer.info;
      peakCalls = Math.max(peakCalls, info.render.calls);
      peakTris = Math.max(peakTris, info.render.triangles);

      el.textContent = [
        `${(1000 / avg).toFixed(0)} fps   ${avg.toFixed(2)} ms avg`,
        `p95 ${p95.toFixed(2)} ms   worst ${worst.toFixed(2)} ms`,
        `calls  ${info.render.calls}  (peak ${peakCalls})`,
        `tris   ${fmt(info.render.triangles)}  (peak ${fmt(peakTris)})`,
        `progs  ${info.programs ? info.programs.length : 0}`,
        `geom   ${info.memory.geometries}   tex ${info.memory.textures}`,
        `dpr    ${renderer.getPixelRatio().toFixed(2)}`,
      ].join('\n');
    },

    /** Reset the peak trackers (e.g. after teleporting to a new reference pose). */
    resetPeaks() {
      peakCalls = 0;
      peakTris = 0;
    },

    dispose() {
      el.remove();
    },
  };
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
