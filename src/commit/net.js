/**
 * The connection to the wall: the presence server, as the same visitor the hall and the sail know.
 * With `?demo=N` the same rules run in the page against N made-up commitments, for previewing.
 *
 * A commitment posted while the connection is down is kept and sent on reconnecting; the server
 * treats the same words from the same visitor as one commitment, so a retry can't double it.
 */
import { createWallHub } from './wallHub.js';
import { SAMPLES } from './samples.js';
import { getVisitorInfo } from '../modules/visitor.js';
import { presenceCandidates } from '../modules/presenceUrl.js';

export function createNet({ view, token = '', demo = 0, on = {} }) {
  const visitor = getVisitorInfo();
  const net = {
    visitor,
    connected: false,
    demo: !!demo,
    denied: false,
    state: { count: 0, waiting: 0, finaleAt: 0, moderated: true, open: true, storage: '' },
    items: new Map(),
    serverNow: () => Date.now() + offset,
    send: () => {},
  };
  let offset = 0;
  let bestRtt = Infinity;
  const queue = new Map();    // cid -> text, until the server answers

  function applyState(m) {
    for (const k of ['count', 'waiting', 'finaleAt', 'moderated', 'open', 'storage']) {
      if (m[k] !== undefined) net.state[k] = m[k];
    }
    if (m.now && bestRtt === Infinity) offset = m.now - Date.now();
    on.state?.(net.state);
  }

  function receive(m) {
    switch (m.type) {
      case 'commit_welcome':
        net.items = new Map(m.items.map((i) => [i.id, i]));
        applyState(m);
        on.welcome?.(m);
        for (const [cid, text] of queue) net.send({ type: 'commit_post', cid, text });
        break;
      case 'commit_state':
        applyState(m);
        break;
      case 'commit_add':
      case 'commit_admin_add':
      case 'commit_admin_update':
        net.items.set(m.item.id, m.item);
        on.item?.(m.item, m.type);
        break;
      case 'commit_remove':
        net.items.delete(m.id);
        on.removed?.(m.id);
        break;
      case 'commit_mine':
        if (m.removed) net.items.delete(m.item.id);
        else net.items.set(m.item.id, m.item);
        on.mine?.(m.item, m.removed);
        break;
      case 'commit_result':
        queue.delete(m.cid);
        if (m.ok) net.items.set(m.item.id, m.item);
        on.result?.(m);
        break;
      case 'commit_denied':
        net.denied = true;
        on.denied?.();
        break;
      case 'commit_pong': {
        const t = Date.now();
        const rtt = t - m.t;
        if (rtt < bestRtt) {
          bestRtt = rtt;
          offset = m.now - (t - rtt / 2);
        }
        break;
      }
      default:
    }
  }

  const joinMsg = () => ({ type: 'commit_join', view, id: visitor.id, token });

  net.post = (text) => {
    const cid = Math.random().toString(36).slice(2, 12);
    queue.set(cid, text);
    net.send({ type: 'commit_post', cid, text });
  };
  net.admin = (action, extra = {}) => net.send({ type: 'commit_admin', token, action, ...extra });

  const setConnected = (v) => {
    if (net.connected !== v) {
      net.connected = v;
      on.status?.(v);
    }
  };

  if (demo) startDemo();
  else connect();

  function connect() {
    const candidates = presenceCandidates();
    let attempt = 0;
    let delay = 1500;
    let ws = null;
    let pinger = null;
    net.send = (m) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    function open() {
      ws = new WebSocket(candidates[attempt++ % candidates.length]);
      ws.onopen = () => {
        delay = 1500;
        attempt = 0;
        bestRtt = Infinity;
        setConnected(true);
        net.send(joinMsg());
        const ping = () => net.send({ type: 'commit_ping', t: Date.now() });
        ping();
        setTimeout(ping, 400);
        setTimeout(ping, 1200);
        pinger = setInterval(ping, 5000);
      };
      ws.onmessage = (ev) => {
        try { receive(JSON.parse(ev.data)); } catch (err) { console.warn('[commit]', err); }
      };
      ws.onclose = () => {
        clearInterval(pinger);
        setConnected(false);
        setTimeout(open, delay);
        delay = Math.min(10000, delay * 1.5);
      };
      ws.onerror = () => {};
    }
    open();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!ws || ws.readyState > 1)) open();
    });
  }

  function startDemo() {
    const me = { me: true };
    const hub = createWallHub({
      token: 'demo',
      approveFirst: view === 'admin',
      deliver: (c, m) => { if (c === me) queueMicrotask(() => receive(m)); },
    });
    let n = 0;
    const bot = () => {
      const b = { b: n };
      hub.handle(b, { type: 'commit_join', view: 'phone', id: `demo-${n}` });
      hub.handle(b, { type: 'commit_post', cid: 'd', text: SAMPLES[n % SAMPLES.length] });
      n++;
    };
    for (let i = 0; i < demo; i++) bot();
    hub.handle(me, { ...joinMsg(), token: 'demo' });
    net.connected = true;
    net.send = (m) => hub.handle(me, m.token !== undefined ? { ...m, token: 'demo' } : m);
    setInterval(() => hub.tick(), 250);
    if (view !== 'admin') setInterval(() => { if (!net.state.finaleAt && !net.demoPaused) bot(); }, 3000);
  }

  return net;
}
