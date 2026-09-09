/**
 * Presence server for the 3D Diplomatic Hall.
 * Visitors, 3D poses, pledges, stage screen, plus GMC-compatible analytics/engagement.
 * Persistence: Supabase when configured, otherwise local JSON files.
 */
import './load-env.mjs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initSupabase,
  isSupabaseEnabled,
  loadEngagementFromSupabase,
  loadAnalyticsFromSupabase,
  saveAnalyticsToSupabase,
  setHeartInSupabase,
  insertCommentInSupabase,
  recordAnalyticsEvent,
  fetchTrend,
} from './supabase.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const HERE = dirname(fileURLToPath(import.meta.url));

const ENGAGEMENT_PATH = process.env.ENGAGEMENT_PATH || join(HERE, 'data', 'engagement.json');
const ANALYTICS_PATH = process.env.ANALYTICS_PATH || join(dirname(ENGAGEMENT_PATH), 'analytics.json');
const ANALYTICS_TOKEN =
  process.env.ANALYTICS_TOKEN !== undefined ? process.env.ANALYTICS_TOKEN : 'gmc-dev';

const MIN_BOOTH_ID = 1;
const MAX_BOOTH_ID = 20;
const COMMENT_MAX = 200;
const COMMENTS_PER_BOOTH = 40;
const HEART_MIN_INTERVAL_MS = 500;
const COMMENT_MIN_INTERVAL_MS = 8000;
const ANALYTICS_MIN_INTERVAL_MS = 400;
const FLUSH_DEBOUNCE_MS = 1000;
const STALE_MS = 60000;

const visitors = new Map();

// --- Commitment Wall pledges ---
const MAX_PLEDGES = 200;
const PLEDGES_FILE = process.env.PLEDGES_FILE
  || resolve(HERE, 'data', 'pledges.json');
let pledges = [];
try {
  if (existsSync(PLEDGES_FILE)) {
    const parsed = JSON.parse(readFileSync(PLEDGES_FILE, 'utf8'));
    if (Array.isArray(parsed)) pledges = parsed.slice(0, MAX_PLEDGES);
  }
} catch (err) {
  console.warn('Could not read pledges file, starting empty:', err.message);
}
let savePledgeTimer = null;
function savePledgesSoon() {
  if (savePledgeTimer) return;
  savePledgeTimer = setTimeout(() => {
    savePledgeTimer = null;
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

let screenState = {
  src: 'https://www.youtube.com/watch?v=vYIYIVmOo3Q',
  playing: true,
  mediaTime: 0,
  updatedAt: Date.now(),
};

// ---------------------------------------------------------------- engagement
/** `{ [boothId]: { hearts: Set<clientId>, comments: [{ id, name, text, ts }] } }` */
const engagement = new Map();

function boothRecord(boothId) {
  if (!engagement.has(boothId)) {
    engagement.set(boothId, { hearts: new Set(), comments: [] });
  }
  return engagement.get(boothId);
}

function loadEngagement() {
  try {
    const raw = JSON.parse(readFileSync(ENGAGEMENT_PATH, 'utf8'));
    for (const [boothId, value] of Object.entries(raw || {})) {
      const id = Number(boothId);
      if (!Number.isInteger(id)) continue;
      engagement.set(id, {
        hearts: new Set(Array.isArray(value.hearts) ? value.hearts.map(String) : []),
        comments: Array.isArray(value.comments) ? value.comments : [],
      });
    }
    console.log(`[presence] loaded engagement for ${engagement.size} booth(s)`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[presence] could not read engagement:', err.message);
  }
}

function writeEngagement() {
  // When Supabase is live, hearts/comments are written per-action — skip JSON.
  if (isSupabaseEnabled()) return;
  const out = {};
  for (const [boothId, record] of engagement) {
    out[boothId] = { hearts: [...record.hearts], comments: record.comments };
  }
  try {
    mkdirSync(dirname(ENGAGEMENT_PATH), { recursive: true });
    writeFileSync(ENGAGEMENT_PATH, JSON.stringify(out, null, 2));
  } catch (err) {
    console.warn('[presence] could not write engagement:', err.message);
  }
}

// ---------------------------------------------------------------- analytics
const analyticsState = {
  boothOpens: {},
  introPlays: {},
  quizPlays: {},
  quizPasses: {},
  uniqueVisitors: new Set(),
  pageViews: 0,
  peakConcurrent: 0,
  passportCompletions: 0,
};

function loadAnalytics() {
  try {
    const raw = JSON.parse(readFileSync(ANALYTICS_PATH, 'utf8'));
    if (raw.boothOpens) analyticsState.boothOpens = { ...raw.boothOpens };
    if (raw.introPlays) analyticsState.introPlays = { ...raw.introPlays };
    if (raw.quizPlays) analyticsState.quizPlays = { ...raw.quizPlays };
    if (raw.quizPasses) analyticsState.quizPasses = { ...raw.quizPasses };
    if (Array.isArray(raw.uniqueVisitors)) {
      analyticsState.uniqueVisitors = new Set(raw.uniqueVisitors.map(String));
    }
    analyticsState.pageViews = Number(raw.pageViews) || 0;
    analyticsState.peakConcurrent = Number(raw.peakConcurrent) || 0;
    analyticsState.passportCompletions = Number(raw.passportCompletions) || 0;
    console.log('[presence] loaded analytics counters');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[presence] could not read analytics:', err.message);
  }
}

function writeAnalytics() {
  const out = {
    boothOpens: analyticsState.boothOpens,
    introPlays: analyticsState.introPlays,
    quizPlays: analyticsState.quizPlays,
    quizPasses: analyticsState.quizPasses,
    uniqueVisitors: [...analyticsState.uniqueVisitors],
    pageViews: analyticsState.pageViews,
    peakConcurrent: analyticsState.peakConcurrent,
    passportCompletions: analyticsState.passportCompletions,
  };
  if (isSupabaseEnabled()) {
    saveAnalyticsToSupabase({
      boothOpens: analyticsState.boothOpens,
      introPlays: analyticsState.introPlays,
      quizPlays: analyticsState.quizPlays,
      quizPasses: analyticsState.quizPasses,
      uniqueVisitors: analyticsState.uniqueVisitors,
      pageViews: analyticsState.pageViews,
      peakConcurrent: analyticsState.peakConcurrent,
      passportCompletions: analyticsState.passportCompletions,
    }).catch(() => {});
    return;
  }
  try {
    mkdirSync(dirname(ANALYTICS_PATH), { recursive: true });
    writeFileSync(ANALYTICS_PATH, JSON.stringify(out, null, 2));
  } catch (err) {
    console.warn('[presence] could not write analytics:', err.message);
  }
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeEngagement();
    writeAnalytics();
  }, FLUSH_DEBOUNCE_MS);
}

function bumpCounter(map, boothId) {
  map[boothId] = (Number(map[boothId]) || 0) + 1;
}

function noteVisitor(id) {
  if (!id) return;
  const before = analyticsState.uniqueVisitors.size;
  analyticsState.uniqueVisitors.add(String(id));
  if (analyticsState.uniqueVisitors.size > before) scheduleFlush();
}

function notePeak() {
  if (visitors.size > analyticsState.peakConcurrent) {
    analyticsState.peakConcurrent = visitors.size;
    scheduleFlush();
  }
}

function validBoothId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= MIN_BOOTH_ID && id <= MAX_BOOTH_ID ? id : null;
}

function sanitizeComment(value) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, COMMENT_MAX);
}

function boothPayload(boothId, clientId) {
  const record = boothRecord(boothId);
  return {
    boothId,
    hearts: record.hearts.size,
    liked: clientId ? record.hearts.has(clientId) : false,
    comments: record.comments,
  };
}

function engagementSnapshot(clientId) {
  const out = {};
  for (const boothId of engagement.keys()) {
    out[boothId] = boothPayload(boothId, clientId);
  }
  // Always include empty records for all booths so the client can sync counts.
  for (let id = MIN_BOOTH_ID; id <= MAX_BOOTH_ID; id++) {
    if (!out[id]) out[id] = boothPayload(id, clientId);
  }
  return out;
}

async function analyticsSnapshot() {
  let totalOpens = 0;
  let totalIntros = 0;
  let totalQuizPlays = 0;
  let totalQuizPasses = 0;
  let totalHearts = 0;
  let totalComments = 0;
  const booths = {};
  const recentComments = [];

  for (let id = MIN_BOOTH_ID; id <= MAX_BOOTH_ID; id++) {
    const record = engagement.get(id) || boothRecord(id);
    const opens = Number(analyticsState.boothOpens[id]) || 0;
    const intros = Number(analyticsState.introPlays[id]) || 0;
    const quizPlays = Number(analyticsState.quizPlays[id]) || 0;
    const quizPasses = Number(analyticsState.quizPasses[id]) || 0;
    const hearts = record.hearts.size;
    const comments = record.comments.length;
    totalOpens += opens;
    totalIntros += intros;
    totalQuizPlays += quizPlays;
    totalQuizPasses += quizPasses;
    totalHearts += hearts;
    totalComments += comments;
    booths[id] = { opens, introPlays: intros, quizPlays, quizPasses, hearts, comments };
    for (const c of record.comments) {
      recentComments.push({ boothId: id, name: c.name, text: c.text, ts: c.ts });
    }
  }

  recentComments.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  let trend = [];
  try {
    trend = await fetchTrend(30);
  } catch {
    trend = [];
  }

  return {
    generatedAt: Date.now(),
    onlineNow: visitors.size,
    peakConcurrent: analyticsState.peakConcurrent,
    uniqueVisitors: analyticsState.uniqueVisitors.size,
    pageViews: analyticsState.pageViews,
    totalOpens,
    totalIntroPlays: totalIntros,
    totalQuizPlays,
    totalQuizPasses,
    passportCompletions: analyticsState.passportCompletions,
    totalHearts,
    totalComments,
    booths,
    recentComments: recentComments.slice(0, 30),
    trend: Array.isArray(trend) ? trend : [],
    countries: [],
    storage: isSupabaseEnabled() ? 'supabase' : 'json',
  };
}

function corsJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(status === 204 ? '' : JSON.stringify(body));
}

loadEngagement();
loadAnalytics();

async function bootPersistence() {
  const ok = await initSupabase();
  if (!ok) return;
  try {
    const remoteEng = await loadEngagementFromSupabase();
    if (remoteEng) {
      engagement.clear();
      for (const [id, rec] of remoteEng) engagement.set(id, rec);
      console.log(`[presence] loaded engagement from Supabase (${engagement.size} booths)`);
    }
    const remoteAnalytics = await loadAnalyticsFromSupabase();
    if (remoteAnalytics) {
      analyticsState.boothOpens = { ...remoteAnalytics.boothOpens };
      analyticsState.introPlays = { ...remoteAnalytics.introPlays };
      analyticsState.quizPlays = { ...remoteAnalytics.quizPlays };
      analyticsState.quizPasses = { ...remoteAnalytics.quizPasses };
      analyticsState.uniqueVisitors = new Set(remoteAnalytics.uniqueVisitors || []);
      analyticsState.pageViews = remoteAnalytics.pageViews;
      analyticsState.peakConcurrent = remoteAnalytics.peakConcurrent;
      analyticsState.passportCompletions = remoteAnalytics.passportCompletions;
      console.log('[presence] loaded analytics totals from Supabase');
    }
  } catch (err) {
    console.warn('[presence] Supabase hydrate failed:', err.message);
  }
}

bootPersistence().catch((err) => console.warn('[presence] boot:', err.message));

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    corsJson(res, 204, {});
    return;
  }

  if (url.pathname === '/health') {
    corsJson(res, 200, {
      status: 'ok',
      ok: true,
      visitors: visitors.size,
      players: visitors.size,
      pledges: pledges.length,
      screenState,
    });
    return;
  }

  if (url.pathname === '/pledges') {
    corsJson(res, 200, pledges);
    return;
  }

  if (url.pathname === '/analytics') {
    const token = url.searchParams.get('token') || '';
    if (ANALYTICS_TOKEN && token !== ANALYTICS_TOKEN) {
      corsJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    analyticsSnapshot()
      .then((snap) => corsJson(res, 200, { ok: true, ...snap }))
      .catch((err) => {
        console.warn('[presence] analytics snapshot failed:', err.message);
        corsJson(res, 500, { ok: false, error: 'snapshot_failed' });
      });
    return;
  }

  corsJson(res, 404, { ok: false, error: 'not_found' });
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
  notePeak();
  broadcast({ type: 'count', count: visitors.size, n: visitors.size });
}

function broadcastEngagement(boothId) {
  for (const [id, v] of visitors.entries()) {
    if (v.ws.readyState === WebSocket.OPEN) {
      v.ws.send(JSON.stringify({ type: 'booth_engagement', ...boothPayload(boothId, id) }));
    }
  }
}

wss.on('connection', (ws) => {
  let visitorId = null;
  const limits = {
    heart: 0,
    comment: 0,
    boothOpen: 0,
    introPlay: 0,
    quizComplete: 0,
    passportComplete: 0,
    pageView: 0,
  };

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const now = Date.now();

      if (msg.type === 'join') {
        visitorId = msg.id || msg.clientId || `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        noteVisitor(visitorId);
        const visitorData = {
          id: visitorId,
          name: (msg.name || 'Delegate').slice(0, 24),
          color: msg.color || '#4FA69C',
          x: Number(msg.x) || 9.68,
          y: Number(msg.y) || 1.45,
          z: Number(msg.z) || -2.5,
          yaw: Number(msg.yaw) || 0,
          updatedAt: now,
        };

        const prev = visitors.get(visitorId);
        if (prev && prev.ws && prev.ws !== ws) {
          try {
            prev.ws._replacedByRejoin = true;
            prev.ws.close();
          } catch (e) {}
        }

        visitors.set(visitorId, { ws, ...visitorData });
        notePeak();

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
          soft: !!msg.soft,
          visitors: activeVisitors,
          screen: screenState,
          count: visitors.size,
          pledges,
          engagement: engagementSnapshot(visitorId),
        }));

        if (!msg.soft || !prev) {
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
        } else {
          broadcast({
            type: 'moved',
            id: visitorId,
            x: visitorData.x,
            y: visitorData.y,
            z: visitorData.z,
            yaw: visitorData.yaw,
          }, ws);
        }

        broadcastHeadcount();
      } else if (msg.type === 'move' && visitorId) {
        const v = visitors.get(visitorId);
        if (v) {
          v.x = Number(msg.x);
          v.y = Number(msg.y);
          v.z = Number(msg.z);
          v.yaw = Number(msg.yaw);
          v.updatedAt = now;

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
            updatedAt: now,
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
      } else if (msg.type === 'heart' && visitorId) {
        const v = visitors.get(visitorId);
        if (!v) return;
        v.updatedAt = now;
        if (now - limits.heart < HEART_MIN_INTERVAL_MS) return;
        limits.heart = now;

        const boothId = validBoothId(msg.boothId ?? msg.heart?.boothId);
        if (!boothId) return;

        const record = boothRecord(boothId);
        let liked;
        if (record.hearts.has(visitorId)) {
          record.hearts.delete(visitorId);
          liked = false;
        } else {
          record.hearts.add(visitorId);
          liked = true;
        }

        setHeartInSupabase(boothId, visitorId, liked).catch(() => {});
        scheduleFlush();
        broadcastEngagement(boothId);
      } else if (msg.type === 'comment' && visitorId) {
        const v = visitors.get(visitorId);
        if (!v) return;
        v.updatedAt = now;
        if (now - limits.comment < COMMENT_MIN_INTERVAL_MS) {
          ws.send(JSON.stringify({ type: 'comment_rejected', reason: 'too_fast' }));
          return;
        }

        const boothId = validBoothId(msg.boothId);
        const text = sanitizeComment(msg.text);
        if (!boothId || !text) {
          ws.send(JSON.stringify({ type: 'comment_rejected', reason: 'invalid' }));
          return;
        }
        limits.comment = now;

        const comment = {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          boothId,
          visitorId,
          name: v.name,
          text,
          ts: now,
        };
        const record = boothRecord(boothId);
        record.comments.unshift({
          id: comment.id,
          name: comment.name,
          text: comment.text,
          ts: comment.ts,
        });
        record.comments.length = Math.min(record.comments.length, COMMENTS_PER_BOOTH);

        insertCommentInSupabase(comment).catch(() => {});
        scheduleFlush();
        broadcastEngagement(boothId);
      } else if (msg.type === 'page_view') {
        const actor = visitorId || String(msg.clientId || '').slice(0, 64);
        if (!actor || limits.pageView) return;
        limits.pageView = now;
        analyticsState.pageViews += 1;
        noteVisitor(actor);
        recordAnalyticsEvent({ type: 'page_view', visitorId: actor });
        scheduleFlush();
      } else if (msg.type === 'booth_open' || msg.type === 'intro_play') {
        const actor = visitorId || String(msg.clientId || '').slice(0, 64);
        if (!actor) return;
        const limitKey = msg.type === 'booth_open' ? 'boothOpen' : 'introPlay';
        if (now - limits[limitKey] < ANALYTICS_MIN_INTERVAL_MS) return;
        limits[limitKey] = now;
        const boothId = validBoothId(msg.boothId);
        if (!boothId) return;
        noteVisitor(actor);
        if (msg.type === 'booth_open') bumpCounter(analyticsState.boothOpens, boothId);
        else bumpCounter(analyticsState.introPlays, boothId);
        recordAnalyticsEvent({ type: msg.type, boothId, visitorId: actor });
        scheduleFlush();
      } else if (msg.type === 'quiz_complete') {
        const actor = visitorId || String(msg.clientId || '').slice(0, 64);
        if (!actor) return;
        if (now - limits.quizComplete < ANALYTICS_MIN_INTERVAL_MS) return;
        limits.quizComplete = now;
        const boothId = validBoothId(msg.boothId);
        if (!boothId) return;
        noteVisitor(actor);
        bumpCounter(analyticsState.quizPlays, boothId);
        if (msg.passed) bumpCounter(analyticsState.quizPasses, boothId);
        recordAnalyticsEvent({ type: 'quiz_play', boothId, visitorId: actor });
        if (msg.passed) recordAnalyticsEvent({ type: 'quiz_pass', boothId, visitorId: actor });
        scheduleFlush();
      } else if (msg.type === 'passport_complete') {
        const actor = visitorId || String(msg.clientId || '').slice(0, 64);
        if (!actor) return;
        if (now - limits.passportComplete < ANALYTICS_MIN_INTERVAL_MS) return;
        limits.passportComplete = now;
        noteVisitor(actor);
        analyticsState.passportCompletions += 1;
        recordAnalyticsEvent({ type: 'passport_complete', visitorId: actor });
        scheduleFlush();
      } else if (msg.type === 'ping') {
        const v = visitorId ? visitors.get(visitorId) : null;
        if (v) v.updatedAt = now;
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  ws.on('close', () => {
    if (ws._replacedByRejoin) return;
    if (visitorId && visitors.has(visitorId) && visitors.get(visitorId).ws === ws) {
      visitors.delete(visitorId);
      broadcast({ type: 'left', id: visitorId });
      broadcastHeadcount();
    }
  });

  ws.on('error', () => {
    if (ws._replacedByRejoin) return;
    if (visitorId && visitors.has(visitorId) && visitors.get(visitorId).ws === ws) {
      visitors.delete(visitorId);
      broadcast({ type: 'left', id: visitorId });
      broadcastHeadcount();
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, v] of visitors.entries()) {
    if (now - v.updatedAt > STALE_MS || v.ws.readyState !== WebSocket.OPEN) {
      try { v.ws.terminate(); } catch (e) {}
      visitors.delete(id);
      broadcast({ type: 'left', id });
    }
  }
}, 5000);

server.listen(PORT, HOST, () => {
  console.log(`Presence server running on http://${HOST}:${PORT} (ws://${HOST}:${PORT})`);
  console.log(`Analytics: GET /analytics?token=${ANALYTICS_TOKEN || '(open)'}`);
});
