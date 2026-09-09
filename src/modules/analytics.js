const STORAGE_KEY = 'yim_booth_opens';

/**
 * Minimal, dependency-free analytics: tracks which booths get opened.
 * Logs to the console and tallies counts in localStorage so you can sanity
 * check engagement without any backend. If real analytics are wired up
 * later (GA4, Plausible, etc.), just add a call inside `track()` — e.g.
 * `window.gtag?.('event', name, payload)` or `window.plausible?.(name, { props: payload })`.
 */
export function track(eventName, payload = {}) {
  try {
    window.gtag?.('event', eventName, payload);
    window.plausible?.(eventName, { props: payload });

    if (eventName === 'booth_open' && payload.boothId) {
      const counts = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      counts[payload.boothId] = (counts[payload.boothId] || 0) + 1;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
    }
  } catch {
    // Analytics must never break the experience.
  }
}

export function getBoothOpenCounts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
