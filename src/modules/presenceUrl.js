/**
 * Where to find the presence server, for the pages that talk to it directly (the sailing opening and
 * the commitment wall): an explicit `?presence=`, the local dev server, then the deployed one.
 */
export function presenceCandidates() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const explicit = new URLSearchParams(loc.search).get('presence');
  if (explicit) return [explicit];
  const list = [];
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.)/.test(loc.hostname);
  const port = typeof __PRESENCE_PORT__ !== 'undefined' ? __PRESENCE_PORT__ : '8787';
  if (local) {
    list.push(`${proto}//${loc.host}/presence`, `ws://${loc.hostname}:${port}/presence`);
  }
  const env = import.meta.env && (import.meta.env.VITE_WS_URL || import.meta.env.VITE_PRESENCE_WS_URL);
  if (env) list.push(env);
  if (!local) list.push(`${proto}//${loc.host}/presence`);
  return list;
}
