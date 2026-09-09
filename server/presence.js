/**
 * Presence server for the 3D Diplomatic Hall.
 * Handles visitor presence, 3D coordinates (x, y, z, yaw), and synchronized stage screen state.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const visitors = new Map();

// --- Commitment Wall pledges: shared by every visitor, persisted across restarts ---
const MAX_PLEDGES = 200;
const PLEDGES_FILE = process.env.PLEDGES_FILE
  || resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'pledges.json');
let pledges = [];
try {
  if (existsSync(PLEDGES_FILE)) {
    const parsed = JSON.parse(readFileSync(PLEDGES_FILE, 'utf8'));
    if (Array.isArray(parsed)) pledges = parsed.slice(0, MAX_PLEDGES);
  }
} catch (err) {
  console.warn('Could not read pledges file, starting empty:', err.message);
}
let saveTimer = null;
function savePledgesSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(PLEDGES_FILE), { recursive: true });
      writeFileSync(PLEDGES_FILE, JSON.stringify(pledges, null, 2));
    } catch (err) {
      console.warn('Could not save pledges:', err.message);
    }
  }, 500);
}
function sanitizePledge(raw, fallbackName) {
  if (!raw || typeof raw.text !== 'string') return null;
  const text = raw.text.trim().slice(0, 160);
  if (!text) return null;
  const id = raw.id ? String(raw.id).slice(0, 64) : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    text,
    color: /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : '#fef08a',
    by: String(raw.by || fallbackName || 'Delegate').slice(0, 24),
    ts: Number.isFinite(Number(raw.ts)) ? Number(raw.ts) : Date.now(),
  };
}

// Stage screen state (default YouTube live stream from GMC)
let screenState = {
  src: 'https://www.youtube.com/watch?v=vYIYIVmOo3Q',
  playing: true,
  mediaTime: 0,
  updatedAt: Date.now(),
};

const server = createServer((req, res) => {
  if (req.url === '/health' || req.url?.startsWith('/health?')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    // Both shapes: this 3D hall (`status`/`visitors`) and the legacy 2D GMC probe (`ok`/`players`).
    res.end(JSON.stringify({
      status: 'ok',
      ok: true,
      visitors: visitors.size,
      players: visitors.size,
      pledges: pledges.length,
      screenState,
    }));
    return;
  }
  if (req.url === '/pledges') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(pledges));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

function broadcast(msg, excludeWs = null) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastHeadcount() {
  broadcast({ type: 'count', count: visitors.size, n: visitors.size });
}

wss.on('connection', (ws) => {
  let visitorId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        visitorId = msg.id || msg.clientId || `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const visitorData = {
          id: visitorId,
          name: (msg.name || 'Delegate').slice(0, 24),
          color: msg.color || '#4FA69C',
          x: Number(msg.x) || 9.68,
          y: Number(msg.y) || 1.45,
          z: Number(msg.z) || -2.5,
          yaw: Number(msg.yaw) || 0,
          updatedAt: Date.now(),
        };

        visitors.set(visitorId, { ws, ...visitorData });

        // Send welcome snapshot to new visitor
        const activeVisitors = [];
        for (const [id, v] of visitors.entries()) {
          if (id !== visitorId) {
            activeVisitors.push({
              id: v.id,
              name: v.name,
              color: v.color,
              x: v.x,
              y: v.y,
              z: v.z,
              yaw: v.yaw,
            });
          }
        }

        ws.send(JSON.stringify({
          type: 'welcome',
          id: visitorId,
          visitors: activeVisitors,
          screen: screenState,
          count: visitors.size,
          pledges,
        }));

        // Notify others
        broadcast({
          type: 'joined',
          visitor: {
            id: visitorId,
            name: visitorData.name,
            color: visitorData.color,
            x: visitorData.x,
            y: visitorData.y,
            z: visitorData.z,
            yaw: visitorData.yaw,
          },
        }, ws);

        broadcastHeadcount();
      } else if (msg.type === 'move' && visitorId) {
        const v = visitors.get(visitorId);
        if (v) {
          v.x = Number(msg.x);
          v.y = Number(msg.y);
          v.z = Number(msg.z);
          v.yaw = Number(msg.yaw);
          v.updatedAt = Date.now();

          broadcast({
            type: 'moved',
            id: visitorId,
            x: v.x,
            y: v.y,
            z: v.z,
            yaw: v.yaw,
          }, ws);
        }
      } else if (msg.type === 'screen_state') {
        if (msg.screen) {
          screenState = {
            ...screenState,
            ...msg.screen,
            updatedAt: Date.now(),
          };
          broadcast({ type: 'screen_state', screen: screenState }, ws);
        }
      } else if (msg.type === 'pledge') {
        const v = visitorId ? visitors.get(visitorId) : null;
        const pledge = sanitizePledge(msg.pledge, v && v.name);
        if (pledge && !pledges.some((p) => p.id === pledge.id)) {
          pledges.unshift(pledge);
          if (pledges.length > MAX_PLEDGES) pledges.length = MAX_PLEDGES;
          savePledgesSoon();
          broadcast({ type: 'pledge', pledge }, ws);
        }
      } else if (msg.type === 'heart') {
        if (msg.heart && Number.isFinite(Number(msg.heart.boothId))) {
          broadcast({
            type: 'heart',
            heart: {
              boothId: Number(msg.heart.boothId),
              delta: Math.sign(Number(msg.heart.delta) || 1),
            },
          }, ws);
        }
      } else if (msg.type === 'ping') {
        const v = visitorId ? visitors.get(visitorId) : null;
        if (v) v.updatedAt = Date.now();
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  ws.on('close', () => {
    if (visitorId && visitors.has(visitorId)) {
      visitors.delete(visitorId);
      broadcast({ type: 'left', id: visitorId });
      broadcastHeadcount();
    }
  });

  ws.on('error', () => {
    if (visitorId && visitors.has(visitorId)) {
      visitors.delete(visitorId);
      broadcast({ type: 'left', id: visitorId });
      broadcastHeadcount();
    }
  });
});

// Stale connection cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, v] of visitors.entries()) {
    if (now - v.updatedAt > 20000 || v.ws.readyState !== WebSocket.OPEN) {
      try { v.ws.terminate(); } catch (e) {}
      visitors.delete(id);
      broadcast({ type: 'left', id });
    }
  }
}, 5000);

server.listen(PORT, HOST, () => {
  console.log(`Presence server running on http://${HOST}:${PORT} (ws://${HOST}:${PORT})`);
});
