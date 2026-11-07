/**
 * The sailing opening's room on the presence server. All the rules live in src/sail/raceHub.js;
 * this only carries its messages over the existing WebSocket connection. Sailors are not hall
 * visitors: they don't join `visitors`, so boats never appear as avatars or in the hall count.
 */
import { WebSocket } from 'ws';
import { createRaceHub } from '../src/sail/raceHub.js';

const TICK_MS = 250;

export function createSailRoom({ token }) {
  // Most messages go to everyone, so serialise each one only once.
  let lastMsg = null;
  let lastData = '';
  const hub = createRaceHub({
    token,
    deliver(ws, msg) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (msg !== lastMsg) {
        lastMsg = msg;
        lastData = JSON.stringify(msg);
      }
      ws.send(lastData);
    },
  });
  setInterval(() => hub.tick(), TICK_MS).unref();

  return {
    /** Returns true if this was a sailing message. */
    handle(ws, msg) {
      if (typeof msg.type !== 'string' || !msg.type.startsWith('sail_')) return false;
      hub.handle(ws, msg);
      return true;
    },
    drop: (ws) => hub.drop(ws),
    stats: () => hub.stats(),
  };
}
