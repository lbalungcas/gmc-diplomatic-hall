/**
 * Multiplayer presence client for 3D Diplomatic Hall.
 * Mirrors GMC 2D hall architecture with WebSocket server sync + BroadcastChannel multi-tab fallback.
 */

const PALETTE = ['#F4B400', '#4FA69C', '#7BA3D4', '#E8A87C', '#C4A4D8', '#6EC4B8'];

export function colorFromId(id) {
  const s = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function getVisitorInfo() {
  let id = localStorage.getItem('gmc_visitor_id');
  if (!id) {
    id = 'v-' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('gmc_visitor_id', id);
  }

  let name = localStorage.getItem('gmc_visitor_name');
  if (!name) {
    const num = Math.floor(100 + Math.random() * 900);
    name = `Delegate #${num}`;
    localStorage.setItem('gmc_visitor_name', name);
  }

  const color = colorFromId(id);
  return { id, name, color };
}

export function createPresence({
  onWelcome,
  onJoined,
  onMoved,
  onLeft,
  onCount,
  onScreen,
  onPledge,
  onHeart,
  onStatus,
} = {}) {
  const visitor = getVisitorInfo();
  let ws = null;
  let isConnected = false;
  let moveThrottleTimer = null;
  let pendingMove = null;
  let bc = null;
  let attempt = 0;
  let reconnectTimer = null;
  let everConnected = false;

  function setStatus(connected, detail) {
    const changed = connected !== isConnected;
    isConnected = connected;
    if (connected) everConnected = true;
    if (changed || detail) onStatus?.({ connected, everConnected, attempt, detail });
  }

  // BroadcastChannel for instant local multi-tab sync
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('gmc_3d_multiplayer');
      bc.onmessage = (event) => {
        const msg = event.data;
        if (!msg || msg.senderId === visitor.id) return;

        if (msg.type === 'bc_join') {
          onJoined?.(msg.visitor);
          // Respond so the new tab knows about us
          bc.postMessage({
            type: 'bc_announce',
            senderId: visitor.id,
            visitor: {
              id: visitor.id,
              name: visitor.name,
              color: visitor.color,
              x: lastPosition.x,
              y: lastPosition.y,
              z: lastPosition.z,
              yaw: lastPosition.yaw,
            }
          });
        } else if (msg.type === 'bc_announce') {
          onJoined?.(msg.visitor);
        } else if (msg.type === 'bc_move') {
          onMoved?.(msg);
        } else if (msg.type === 'bc_leave') {
          onLeft?.(msg.id);
        } else if (msg.type === 'bc_screen') {
          onScreen?.(msg.screen);
        } else if (msg.type === 'bc_pledge') {
          onPledge?.(msg.pledge);
        } else if (msg.type === 'bc_heart') {
          onHeart?.(msg.heart);
        }
      };
    }
  } catch (e) {
    console.warn('BroadcastChannel not supported:', e);
  }

  let lastPosition = { x: 9.68, y: 1.45, z: -2.5, yaw: 0 };
  let reconnectDelay = 2500;

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // Back off up to 30s so a missing server doesn't get hammered (and the console stays quiet).
    reconnectDelay = Math.min(30000, Math.round(reconnectDelay * 1.7));
  }

  /**
   * Candidate endpoints, tried round-robin on every reconnect:
   *  1. an explicit override (`?presence=wss://…`, `window.PRESENCE_WS_URL`, or
   *     build-time `VITE_WS_URL` / `VITE_PRESENCE_WS_URL` — set on Netlify for Render)
   *  2. same-origin `/presence` (Vite dev/preview proxy → server/presence.js)
   *  3. the presence server's own port on this host (works when no proxy is in front,
   *     e.g. a static production build on the LAN)
   */
  function getWsCandidates() {
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const list = [];
    try {
      const envUrl = (typeof import.meta !== 'undefined' && import.meta.env
        && (import.meta.env.VITE_WS_URL || import.meta.env.VITE_PRESENCE_WS_URL)) || '';
      const override = new URLSearchParams(loc.search).get('presence')
        || window.PRESENCE_WS_URL
        || envUrl;
      if (override) list.push(String(override).trim());
    } catch (e) {}
    list.push(`${proto}//${loc.host}/presence`);
    const directPort = typeof __PRESENCE_PORT__ !== 'undefined' ? __PRESENCE_PORT__ : '8787';
    if (loc.protocol !== 'https:' && String(loc.port) !== String(directPort)) {
      list.push(`ws://${loc.hostname}:${directPort}`);
    }
    return list;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const candidates = getWsCandidates();
    const url = candidates[attempt % candidates.length];
    attempt++;
    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectDelay = 2500;
        attempt = 0;
        setStatus(true, 'connected');
        ws.send(JSON.stringify({
          type: 'join',
          id: visitor.id,
          name: visitor.name,
          color: visitor.color,
          x: lastPosition.x,
          y: lastPosition.y,
          z: lastPosition.z,
          yaw: lastPosition.yaw,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'welcome') {
            onWelcome?.(msg);
          } else if (msg.type === 'joined') {
            onJoined?.(msg.visitor);
          } else if (msg.type === 'moved') {
            onMoved?.(msg);
          } else if (msg.type === 'left') {
            onLeft?.(msg.id);
          } else if (msg.type === 'count') {
            onCount?.(msg.count);
          } else if (msg.type === 'screen_state') {
            onScreen?.(msg.screen);
          } else if (msg.type === 'pledge') {
            onPledge?.(msg.pledge);
          } else if (msg.type === 'heart') {
            onHeart?.(msg.heart);
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        setStatus(false, 'closed');
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose always follows onerror; the reconnect is scheduled there.
        setStatus(false, 'error');
      };
    } catch (e) {
      ws = null;
      setStatus(false, 'error');
      scheduleReconnect();
    }

    // Announce to other tabs via BroadcastChannel (only once — reconnects shouldn't re-announce)
    if (bc && attempt === 1) {
      bc.postMessage({
        type: 'bc_join',
        senderId: visitor.id,
        visitor: {
          id: visitor.id,
          name: visitor.name,
          color: visitor.color,
          x: lastPosition.x,
          y: lastPosition.y,
          z: lastPosition.z,
          yaw: lastPosition.yaw,
        }
      });
    }
  }

  function sendMove(x, y, z, yaw) {
    lastPosition = { x, y, z, yaw };
    pendingMove = { x, y, z, yaw };

    if (!moveThrottleTimer) {
      moveThrottleTimer = setTimeout(() => {
        moveThrottleTimer = null;
        if (pendingMove) {
          if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'move',
              x: Number(pendingMove.x.toFixed(2)),
              y: Number(pendingMove.y.toFixed(2)),
              z: Number(pendingMove.z.toFixed(2)),
              yaw: Number(pendingMove.yaw.toFixed(3)),
            }));
          }
          if (bc) {
            bc.postMessage({
              type: 'bc_move',
              senderId: visitor.id,
              id: visitor.id,
              x: Number(pendingMove.x.toFixed(2)),
              y: Number(pendingMove.y.toFixed(2)),
              z: Number(pendingMove.z.toFixed(2)),
              yaw: Number(pendingMove.yaw.toFixed(3)),
            });
          }
        }
      }, 75); // ~13 updates/sec
    }
  }

  function sendScreen(screen) {
    if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'screen_state', screen }));
    }
    if (bc) {
      bc.postMessage({ type: 'bc_screen', senderId: visitor.id, screen });
    }
  }

  function sendPledge(pledge) {
    if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pledge', pledge }));
    }
    if (bc) {
      bc.postMessage({ type: 'bc_pledge', senderId: visitor.id, pledge });
    }
  }

  function sendHeart(heart) {
    if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heart', heart }));
    }
    if (bc) {
      bc.postMessage({ type: 'bc_heart', senderId: visitor.id, heart });
    }
  }

  // Handle unload to gracefully disconnect
  window.addEventListener('beforeunload', () => {
    if (bc) {
      bc.postMessage({ type: 'bc_leave', senderId: visitor.id, id: visitor.id });
    }
    try { if (ws) ws.close(); } catch (e) {}
  });

  // Coming back online / back to the tab: retry immediately instead of waiting out the back-off.
  window.addEventListener('online', () => { reconnectDelay = 2500; if (!isConnected) connect(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isConnected) { reconnectDelay = 2500; connect(); }
  });

  connect();

  return {
    visitor,
    sendMove,
    sendScreen,
    sendPledge,
    sendHeart,
    reconnect: () => { reconnectDelay = 2500; if (!isConnected) connect(); },
    isConnected: () => isConnected,
  };
}
