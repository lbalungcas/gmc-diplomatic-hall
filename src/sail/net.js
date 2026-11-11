/**
 * The connection to the race. Normally the presence server, over its existing WebSocket, as the
 * same visitor the hall knows (src/modules/visitor.js). With `?demo=N` the same race runs in the
 * page against N bots instead, for previewing without a server.
 */
import { createRaceHub, SAIL_SECONDS } from './raceHub.js';
import { BOAT_NAMES } from './boatNames.js';
import { getVisitorInfo } from '../modules/visitor.js';
import { presenceCandidates } from '../modules/presenceUrl.js';

const ROSTER_ARRIVALS = 12;
// A server that accepts the connection but never welcomes us is running code from before the race
// existed (or is still starting). That is not "connected": nothing we send would do anything.
const WELCOME_TIMEOUT_MS = 6000;

export function createNet({ view, token = '', demo = 0, on = {} }) {
  const visitor = getVisitorInfo();
  const state = {
    phase: 'harbor', mode: 'together', threshold: 30, arrived: 0, boats: 0, startAt: 0, openAt: 0, soundOn: true,
    challengeAt: 0, energyAt: 0, energyGoal: 0, taps: 0, winner: -1, winnerName: '',
  };
  const STATE_KEYS = Object.keys(state);
  const boats = new Map();     // n -> { n, name, p, rank }
  const net = {
    visitor, state, boats, you: null, arrivals: [], connected: false, demo: !!demo,
    /** True while a server takes the connection but doesn't answer the race's hello. */
    noAnswer: false,
    /** True once this page has been connected at least once. */
    wasConnected: false,
    serverNow: () => Date.now() + offset,
    sendProgress: () => {},
    sendTaps: () => {},
    /** Names your boat: the server screens it and answers with `nameResult`. */
    setName: () => {},
    host: () => {},
  };
  let offset = 0;
  let bestRtt = Infinity;
  let welcomed = () => {};

  function applyState(m) {
    const prevPhase = state.phase;
    for (const k of STATE_KEYS) {
      if (m[k] !== undefined) state[k] = m[k];
    }
    if (m.now && bestRtt === Infinity) offset = m.now - Date.now();
    on.state?.(state, prevPhase);
  }

  function receive(m) {
    switch (m.type) {
      case 'sail_welcome':
        welcomed();
        boats.clear();
        for (const [n, name, p, rank] of m.roster) boats.set(n, { n, name, p: p / 1000, rank });
        net.you = m.you;
        net.arrivals = m.arrivals;
        applyState(m);
        on.welcome?.(m);
        break;
      case 'sail_state':
        applyState(m);
        break;
      case 'sail_boat': {
        const b = boats.get(m.n);
        if (b) b.name = m.name;
        else boats.set(m.n, { n: m.n, name: m.name, p: 0, rank: 0 });
        if (net.you && net.you.n === m.n) net.you.name = m.name;
        on.boat?.(m);
        break;
      }
      case 'sail_name_result':
        if (m.ok && net.you) net.you.name = m.name;
        on.nameResult?.(m);
        break;
      case 'sail_snap':
        for (let i = 0; i < m.b.length; i += 2) {
          const b = boats.get(m.b[i]);
          if (b) b.p = m.b[i + 1] / 1000;
        }
        break;
      case 'sail_arrived': {
        const b = boats.get(m.n);
        if (b) { b.rank = m.rank; b.p = 1; }
        net.arrivals.push({ n: m.n, name: m.name, rank: m.rank });
        if (net.arrivals.length > ROSTER_ARRIVALS) net.arrivals.shift();
        if (net.you && net.you.n === m.n) net.you.rank = m.rank;
        on.arrived?.(m);
        break;
      }
      case 'sail_pong': {
        const t = Date.now();
        const rtt = t - m.t;
        if (rtt < bestRtt) {
          bestRtt = rtt;
          offset = m.now - (t - rtt / 2);
        }
        break;
      }
      case 'sail_host_result':
        on.hostResult?.(m);
        break;
      default:
    }
  }

  let myName = '';
  const joinMsg = () => ({ type: 'sail_join', view, id: visitor.id, ...(myName ? { name: myName } : {}) });

  if (demo) {
    startDemo();
  } else {
    connect();
  }

  function setConnected(v) {
    if (net.connected !== v) {
      net.connected = v;
      on.status?.(v);
    }
  }

  function connect() {
    const candidates = presenceCandidates();
    let attempt = 0;
    let delay = 1500;
    let ws = null;
    let pinger = null;
    const send = (m) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    function open() {
      const sock = new WebSocket(candidates[attempt++ % candidates.length]);
      ws = sock;
      let welcomeTimer = 0;
      sock.onopen = () => {
        bestRtt = Infinity;
        send(joinMsg());
        const ping = () => send({ type: 'sail_ping', t: Date.now() });
        ping();
        setTimeout(ping, 400);
        setTimeout(ping, 1200);
        pinger = setInterval(ping, 5000);
        // Connected means the race server said hello back, not just that a socket opened.
        welcomed = () => {
          clearTimeout(welcomeTimer);
          delay = 1500;
          attempt = 0;
          net.noAnswer = false;
          net.wasConnected = true;
          setConnected(true);
        };
        welcomeTimer = setTimeout(() => {
          net.noAnswer = true;
          console.warn('[sail] the server accepted the connection but did not answer: it is not running the race code');
          sock.close();
        }, WELCOME_TIMEOUT_MS);
      };
      sock.onmessage = (ev) => {
        try { receive(JSON.parse(ev.data)); } catch (err) { console.warn('[sail]', err); }
      };
      sock.onclose = () => {
        clearInterval(pinger);
        clearTimeout(welcomeTimer);
        setConnected(false);
        setTimeout(open, delay);
        delay = Math.min(10000, delay * 1.5);
      };
      sock.onerror = () => {};
    }
    open();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!ws || ws.readyState > 1)) open();
    });
    net.sendProgress = (p) => send({ type: 'sail_progress', p });
    net.sendTaps = (n) => send({ type: 'sail_tap', n });
    net.setName = (name) => { myName = name; send(joinMsg()); };
    net.host = (action, extra = {}) => send({ type: 'sail_host', token, action, ...extra });
  }

  function startDemo() {
    const me = { me: true };
    const bots = [];
    const hub = createRaceHub({
      token: 'demo',
      threshold: demo,
      deliver: (c, m) => { if (c === me) queueMicrotask(() => receive(m)); },
    });
    hub.handle(me, joinMsg());
    net.connected = true;
    for (let i = 0; i < demo + 6; i++) {
      const b = { i, p: 0, delay: Math.random() * 3.5 * 1000, rate: 3 + Math.random() * 4 };
      bots.push(b);
      hub.handle(b, { type: 'sail_join', view: 'player', id: `demo-${i}`, name: BOAT_NAMES[i % BOAT_NAMES.length] });
    }
    const q = new URLSearchParams(location.search);
    const hold = q.has('hold');
    let started = 0;
    let last = Date.now();
    setInterval(() => {
      const t = Date.now();
      const dt = t - last;
      last = t;
      if (state.phase === 'sailing' && t >= state.startAt) {
        if (!started) started = t;
        for (const b of bots) {
          if (t - started < b.delay) continue;
          b.p = Math.min(1, b.p + dt / (SAIL_SECONDS * 1000));
          hub.handle(b, { type: 'sail_progress', p: b.p });
        }
      }
      if (state.phase === 'energy' && t >= state.energyAt) {
        for (const b of bots) hub.handle(b, { type: 'sail_tap', n: Math.round((b.rate * dt) / 1000 + Math.random() * 0.5) });
      }
      if (state.phase === 'harbor') { started = 0; for (const b of bots) b.p = 0; }
      // Stands in for the host: a few seconds of "hype", then Light the lighthouse.
      if (!hold && state.phase === 'challenge' && t > state.challengeAt + 5000) {
        hub.handle(me, { type: 'sail_host', token: 'demo', action: 'light' });
      }
      hub.tick();
    }, 200);
    if (q.get('mode') === 'classic') hub.handle(me, { type: 'sail_host', token: 'demo', action: 'mode', value: 'classic' });
    if (!hold) setTimeout(() => hub.handle(me, { type: 'sail_host', token: 'demo', action: 'start' }), 2500);
    net.sendProgress = (p) => hub.handle(me, { type: 'sail_progress', p });
    net.sendTaps = (n) => hub.handle(me, { type: 'sail_tap', n });
    net.setName = (name) => { myName = name; hub.handle(me, joinMsg()); };
    net.host = (action, extra = {}) => hub.handle(me, { type: 'sail_host', token: 'demo', action, ...extra });
  }

  return net;
}
