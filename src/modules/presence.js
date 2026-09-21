/**
 * Multiplayer presence client for 3D Diplomatic Hall.
 * Triple-redundancy presence:
 *  1. WebSocket server sync (local dev proxy on :8787 or cloud Render service)
 *  2. Supabase Realtime Channel fallback (serverless, always online on Netlify / static hosts)
 *  3. BroadcastChannel multi-tab instant sync (offline / local testing)
 */
import { createClient } from '@supabase/supabase-js';

const PALETTE = ['#F4B400', '#4FA69C', '#7BA3D4', '#E8A87C', '#C4A4D8', '#6EC4B8'];

const SUPABASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
  || 'https://ecddxmoakjqfjlxpmkzn.supabase.co';
const SUPABASE_KEY = (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY))
  || 'sb_publishable_r7U4Xc51-_FIXY5qpqTDZg_ixetP-GT';

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

function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  );
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
  onEngagement,
  onCommentRejected,
  onStatus,
} = {}) {
  const visitor = getVisitorInfo();
  let ws = null;
  let isConnected = false;
  let connectionMode = null; // 'ws' | 'supabase' | 'bc' | null
  let moveThrottleTimer = null;
  let pendingMove = null;
  let bc = null;
  let attempt = 0;
  let reconnectTimer = null;
  let everConnected = false;
  let fallbackTimer = null;

  // Supabase Realtime client & channel state
  let sbClient = null;
  let sbChannel = null;
  let sbSubscribed = false;

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
          if (!isConnected) {
            connectionMode = 'bc';
            setStatus(true, 'broadcast_channel');
          }
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
          if (!isConnected) {
            connectionMode = 'bc';
            setStatus(true, 'broadcast_channel');
          }
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
        } else if (msg.type === 'bc_engagement') {
          onEngagement?.(msg.engagement);
        }
      };
    }
  } catch (e) {
    console.warn('BroadcastChannel not supported:', e);
  }

  let lastPosition = { x: 9.68, y: 1.45, z: -2.5, yaw: 0 };
  let reconnectDelay = 2500;
  let heartbeatTimer = null;
  let lastPongAt = 0;
  let closingForReconnect = false;

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    lastPongAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPongAt > 25000) {
        closingForReconnect = true;
        try { ws.close(); } catch (e) {}
        return;
      }
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
    }, 9000);
  }

  function normalizePresenceUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      if (!u.pathname || u.pathname === '/') u.pathname = '/presence';
      return u.toString().replace(/\/$/, '');
    } catch {
      return s.replace(/\/$/, '');
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // Back off up to 30s so a missing server doesn't get hammered.
    reconnectDelay = Math.min(30000, Math.round(reconnectDelay * 1.7));
  }

  /**
   * Candidate endpoints, intelligently prioritized:
   *  1. An explicit override in the query string (`?presence=wss://…`)
   *  2. If running locally (localhost/LAN): same-origin `/presence` & direct port 8787
   *  3. Build-time / environment override (`VITE_WS_URL` / `window.PRESENCE_WS_URL`)
   *  4. Same-origin `/presence`
   */
  function getWsCandidates() {
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const list = [];
    const directPort = typeof __PRESENCE_PORT__ !== 'undefined' ? __PRESENCE_PORT__ : '8787';

    // 1. Explicit query parameter override
    try {
      const explicitParam = new URLSearchParams(loc.search).get('presence');
      if (explicitParam) {
        const override = normalizePresenceUrl(explicitParam);
        if (override) {
          list.push(override);
          return list;
        }
      }
    } catch (e) {}

    // 2. Local development: always prioritize local dev server & direct presence port
    if (isLocalHost(loc.hostname)) {
      list.push(`${proto}//${loc.host}/presence`);
      if (String(loc.port) !== String(directPort)) {
        list.push(`ws://${loc.hostname}:${directPort}`);
        list.push(`ws://${loc.hostname}:${directPort}/presence`);
      }
    }

    // 3. Environment variable override if configured
    try {
      const envUrl = (typeof import.meta !== 'undefined' && import.meta.env
        && (import.meta.env.VITE_WS_URL || import.meta.env.VITE_PRESENCE_WS_URL)) || '';
      const normalizedEnv = normalizePresenceUrl(window.PRESENCE_WS_URL || envUrl);
      if (normalizedEnv && !list.includes(normalizedEnv)) {
        list.push(normalizedEnv);
      }
    } catch (e) {}

    // 4. Same-origin fallback
    const sameOrigin = `${proto}//${loc.host}/presence`;
    if (!list.includes(sameOrigin)) {
      list.push(sameOrigin);
    }

    return list;
  }

  /**
   * Fallback to Supabase Realtime Channel:
   * Enables zero-server multiplayer when deployed to static hosts (like Netlify)
   * or when the dedicated WebSocket server is sleeping/offline.
   */
  function connectSupabaseFallback() {
    if (connectionMode === 'ws' || sbSubscribed || sbChannel) return;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;

    try {
      if (!sbClient) {
        sbClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      }

      sbChannel = sbClient.channel('diplomatic-hall-multiplayer', {
        config: { presence: { key: visitor.id } },
      });

      sbChannel
        .on('presence', { event: 'sync' }, () => {
          if (connectionMode === 'ws') return;
          const state = sbChannel.presenceState();
          const list = [];
          for (const key in state) {
            const arr = state[key];
            if (Array.isArray(arr) && arr.length > 0) {
              const p = arr[0];
              if (p && p.id) list.push(p);
            }
          }
          if (list.length > 0) {
            onWelcome?.({
              id: visitor.id,
              visitors: list,
              count: list.length,
            });
            onCount?.(list.length);
          }
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          if (connectionMode === 'ws') return;
          if (Array.isArray(newPresences)) {
            for (const p of newPresences) {
              if (p && p.id && p.id !== visitor.id) onJoined?.(p);
            }
          }
        })
        .on('presence', { event: 'leave' }, ({ key }) => {
          if (connectionMode === 'ws') return;
          if (key && key !== visitor.id) onLeft?.(key);
        })
        .on('broadcast', { event: 'move' }, ({ payload }) => {
          if (connectionMode === 'ws') return;
          if (payload && payload.id && payload.id !== visitor.id) {
            onMoved?.(payload);
          }
        })
        .on('broadcast', { event: 'screen' }, ({ payload }) => {
          if (connectionMode === 'ws') return;
          if (payload) onScreen?.(payload);
        })
        .on('broadcast', { event: 'pledge' }, ({ payload }) => {
          if (connectionMode === 'ws') return;
          if (payload) onPledge?.(payload);
        })
        .on('broadcast', { event: 'heart' }, ({ payload }) => {
          if (connectionMode === 'ws') return;
          if (payload) onHeart?.(payload);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            sbSubscribed = true;
            if (connectionMode !== 'ws') {
              connectionMode = 'supabase';
              setStatus(true, 'supabase_realtime');
              await sbChannel.track({
                id: visitor.id,
                name: visitor.name,
                color: visitor.color,
                x: lastPosition.x,
                y: lastPosition.y,
                z: lastPosition.z,
                yaw: lastPosition.yaw,
              });
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            sbSubscribed = false;
            if (connectionMode === 'supabase') {
              connectionMode = null;
              setStatus(false, 'supabase_closed');
            }
          }
        });
    } catch (err) {
      console.warn('[presence] Supabase fallback initialization warning:', err);
    }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const candidates = getWsCandidates();
    const url = candidates[attempt % candidates.length];
    attempt++;

    // If WebSocket hasn't connected in 2.5s, trigger Supabase fallback in parallel
    if (!fallbackTimer && !sbSubscribed) {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!isConnected) {
          connectSupabaseFallback();
        }
      }, 2500);
    }

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectDelay = 1800;
        attempt = 0;
        closingForReconnect = false;
        connectionMode = 'ws';
        const softRejoin = everConnected;
        setStatus(true, 'websocket');
        startHeartbeat();

        // If Supabase was tracking presence, untrack to avoid duplicate count
        if (sbChannel && sbSubscribed) {
          try { sbChannel.untrack(); } catch (e) {}
        }

        // Send both `id` (3D hall) and `clientId` (legacy 2D GMC presence on Render).
        ws.send(JSON.stringify({
          type: 'join',
          id: visitor.id,
          clientId: visitor.id,
          name: visitor.name,
          color: visitor.color,
          soft: softRejoin,
          x: lastPosition.x,
          y: lastPosition.y,
          z: lastPosition.z,
          yaw: lastPosition.yaw,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pong') {
            lastPongAt = Date.now();
          } else if (msg.type === 'welcome') {
            lastPongAt = Date.now();
            const normalized = {
              ...msg,
              id: msg.id || msg.selfId,
              soft: !!msg.soft,
              visitors: Array.isArray(msg.visitors)
                ? msg.visitors
                : (Array.isArray(msg.players) ? msg.players : []),
              count: msg.count ?? msg.n,
              screen: msg.screen || msg.screenState,
            };
            onWelcome?.(normalized);
            if (normalized.count != null) onCount?.(normalized.count);
          } else if (msg.type === 'joined') {
            onJoined?.(msg.visitor || msg);
          } else if (msg.type === 'moved') {
            onMoved?.(msg);
          } else if (msg.type === 'left') {
            onLeft?.(msg.id);
          } else if (msg.type === 'count') {
            onCount?.(msg.count ?? msg.n);
          } else if (msg.type === 'screen_state') {
            onScreen?.(msg.screen || msg);
          } else if (msg.type === 'pledge') {
            onPledge?.(msg.pledge);
          } else if (msg.type === 'heart') {
            onHeart?.(msg.heart || msg);
          } else if (msg.type === 'booth_engagement') {
            onEngagement?.(msg);
          } else if (msg.type === 'comment_rejected') {
            onCommentRejected?.(msg);
          } else if (msg.type === 'error') {
            setStatus(false, msg.reason || 'error');
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        clearHeartbeat();
        const wasWs = connectionMode === 'ws';
        if (wasWs) connectionMode = null;
        ws = null;

        // Try Supabase fallback if WebSocket closed
        connectSupabaseFallback();

        if (!sbSubscribed) {
          setStatus(false, closingForReconnect ? 'watchdog' : 'closed');
        }
        closingForReconnect = false;
        scheduleReconnect();
      };

      ws.onerror = () => {
        connectSupabaseFallback();
      };
    } catch (e) {
      ws = null;
      connectSupabaseFallback();
      if (!sbSubscribed) {
        setStatus(false, 'error');
      }
      scheduleReconnect();
    }

    // Announce to other tabs via BroadcastChannel
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
          // 1. WebSocket
          if (connectionMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'move',
              x: Number(pendingMove.x.toFixed(2)),
              y: Number(pendingMove.y.toFixed(2)),
              z: Number(pendingMove.z.toFixed(2)),
              yaw: Number(pendingMove.yaw.toFixed(3)),
            }));
          }
          // 2. Supabase Realtime Broadcast
          else if (connectionMode === 'supabase' && sbChannel && sbSubscribed) {
            sbChannel.send({
              type: 'broadcast',
              event: 'move',
              payload: {
                id: visitor.id,
                name: visitor.name,
                color: visitor.color,
                x: Number(pendingMove.x.toFixed(2)),
                y: Number(pendingMove.y.toFixed(2)),
                z: Number(pendingMove.z.toFixed(2)),
                yaw: Number(pendingMove.yaw.toFixed(3)),
              },
            });
          }
          // 3. Local BroadcastChannel
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
      }, 85); // ~12 updates/sec max
    }
  }

  function sendScreen(screen) {
    if (connectionMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'screen_state', screen }));
    } else if (connectionMode === 'supabase' && sbChannel && sbSubscribed) {
      sbChannel.send({ type: 'broadcast', event: 'screen', payload: screen });
    }
    if (bc) {
      bc.postMessage({ type: 'bc_screen', senderId: visitor.id, screen });
    }
  }

  function sendPledge(pledge) {
    if (connectionMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pledge', pledge }));
    } else if (connectionMode === 'supabase' && sbChannel && sbSubscribed) {
      sbChannel.send({ type: 'broadcast', event: 'pledge', payload: pledge });
    }
    if (bc) {
      bc.postMessage({ type: 'bc_pledge', senderId: visitor.id, pledge });
    }
  }

  function sendHeart(boothIdOrPayload) {
    const boothId = typeof boothIdOrPayload === 'object'
      ? Number(boothIdOrPayload.boothId)
      : Number(boothIdOrPayload);
    if (!Number.isFinite(boothId)) return;
    if (connectionMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heart', boothId }));
    } else if (connectionMode === 'supabase' && sbChannel && sbSubscribed) {
      sbChannel.send({ type: 'broadcast', event: 'heart', payload: { boothId } });
    }
    if (bc) {
      bc.postMessage({ type: 'bc_heart', senderId: visitor.id, heart: { boothId } });
    }
  }

  function sendComment(boothId, text) {
    const id = Number(boothId);
    const body = String(text || '').trim().slice(0, 200);
    if (!Number.isFinite(id) || !body) return false;
    if (connectionMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'comment', boothId: id, text: body }));
      return true;
    } else if (sbClient) {
      // In Supabase mode, record comment directly
      sbClient.from('booth_comments').insert({
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        booth_id: id,
        visitor_id: visitor.id,
        name: visitor.name,
        body,
      }).then(() => {}).catch(() => {});
      return true;
    }
    return false;
  }

  function sendAnalytics(type, payload = {}) {
    if (connectionMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type, clientId: visitor.id, ...payload }));
      } catch (e) {}
    } else if (sbClient) {
      sbClient.from('analytics_events').insert({
        type,
        visitor_id: visitor.id,
        booth_id: payload.boothId || null,
      }).then(() => {}).catch(() => {});
    }
  }

  // Handle unload to gracefully disconnect
  window.addEventListener('beforeunload', () => {
    if (bc) {
      bc.postMessage({ type: 'bc_leave', senderId: visitor.id, id: visitor.id });
    }
    if (sbChannel) {
      try {
        sbChannel.untrack();
        sbChannel.unsubscribe();
      } catch (e) {}
    }
    try { if (ws) ws.close(); } catch (e) {}
  });

  // Coming back online / back to the tab: retry immediately
  window.addEventListener('online', () => {
    reconnectDelay = 2500;
    if (!isConnected) connect();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isConnected) {
      reconnectDelay = 2500;
      connect();
    }
  });

  connect();

  return {
    visitor,
    sendMove,
    sendScreen,
    sendPledge,
    sendHeart,
    sendComment,
    sendAnalytics,
    reconnect: () => { reconnectDelay = 2500; if (!isConnected) connect(); },
    isConnected: () => isConnected,
    getMode: () => connectionMode,
  };
}
