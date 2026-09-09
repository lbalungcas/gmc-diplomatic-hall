/**
 * Supabase persistence for hall analytics + booth engagement.
 * When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are unset, every export is a no-op.
 */
import { createClient } from '@supabase/supabase-js';

const URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || ''
).trim();

let sb = null;
let ready = false;
const TREND_TTL_MS = 10_000;
let trendCache = { at: 0, data: [] };

export function isSupabaseEnabled() {
  return ready && !!sb;
}

export async function initSupabase() {
  if (!URL || !KEY) {
    console.log('[presence] Supabase unset — using local JSON for analytics/engagement');
    return false;
  }
  try {
    sb = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await sb.from('hall_analytics_totals').select('id').limit(1);
    if (error) {
      console.warn('[presence] Supabase ping failed:', error.message);
      console.warn('[presence] Run server/schema.sql in the Supabase SQL Editor, then restart.');
      sb = null;
      ready = false;
      return false;
    }
    ready = true;
    console.log('[presence] Supabase ready (analytics + engagement)');
    return true;
  } catch (err) {
    console.warn('[presence] Supabase init failed:', err.message);
    sb = null;
    ready = false;
    return false;
  }
}

/** Load hearts/comments into the in-memory engagement Map shape. */
export async function loadEngagementFromSupabase() {
  if (!isSupabaseEnabled()) return null;
  const out = new Map();

  const { data: hearts, error: hErr } = await sb
    .from('booth_hearts')
    .select('booth_id, visitor_id');
  if (hErr) {
    console.warn('[presence] booth_hearts load:', hErr.message);
    return null;
  }

  const { data: comments, error: cErr } = await sb
    .from('booth_comments')
    .select('id, booth_id, visitor_id, name, body, ts')
    .order('ts', { ascending: false });
  if (cErr) {
    console.warn('[presence] booth_comments load:', cErr.message);
    return null;
  }

  for (const row of hearts || []) {
    const id = Number(row.booth_id);
    if (!out.has(id)) out.set(id, { hearts: new Set(), comments: [] });
    out.get(id).hearts.add(String(row.visitor_id));
  }
  for (const row of comments || []) {
    const id = Number(row.booth_id);
    if (!out.has(id)) out.set(id, { hearts: new Set(), comments: [] });
    out.get(id).comments.push({
      id: row.id,
      name: row.name,
      text: row.body,
      ts: row.ts ? new Date(row.ts).getTime() : Date.now(),
      visitorId: row.visitor_id || undefined,
    });
  }
  return out;
}

/** Load counter snapshot into analyticsState-compatible object. */
export async function loadAnalyticsFromSupabase() {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await sb
    .from('hall_analytics_totals')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    console.warn('[presence] hall_analytics_totals load:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    boothOpens: data.booth_opens || {},
    introPlays: data.intro_plays || {},
    quizPlays: data.quiz_plays || {},
    quizPasses: data.quiz_passes || {},
    uniqueVisitors: Array.isArray(data.unique_visitors) ? data.unique_visitors.map(String) : [],
    pageViews: Number(data.page_views) || 0,
    peakConcurrent: Number(data.peak_concurrent) || 0,
    passportCompletions: Number(data.passport_completions) || 0,
  };
}

export async function saveAnalyticsToSupabase(state) {
  if (!isSupabaseEnabled() || !state) return;
  const { error } = await sb.from('hall_analytics_totals').upsert({
    id: 1,
    booth_opens: state.boothOpens || {},
    intro_plays: state.introPlays || {},
    quiz_plays: state.quizPlays || {},
    quiz_passes: state.quizPasses || {},
    unique_visitors: [...(state.uniqueVisitors || [])],
    page_views: Number(state.pageViews) || 0,
    peak_concurrent: Number(state.peakConcurrent) || 0,
    passport_completions: Number(state.passportCompletions) || 0,
    updated_at: new Date().toISOString(),
  });
  if (error) console.warn('[presence] totals upsert:', error.message);
}

export async function setHeartInSupabase(boothId, visitorId, liked) {
  if (!isSupabaseEnabled()) return;
  const bid = Number(boothId);
  const vid = String(visitorId).slice(0, 64);
  if (liked) {
    const { error } = await sb.from('booth_hearts').upsert(
      { booth_id: bid, visitor_id: vid },
      { onConflict: 'booth_id,visitor_id' }
    );
    if (error) console.warn('[presence] heart upsert:', error.message);
  } else {
    const { error } = await sb
      .from('booth_hearts')
      .delete()
      .eq('booth_id', bid)
      .eq('visitor_id', vid);
    if (error) console.warn('[presence] heart delete:', error.message);
  }
}

export async function insertCommentInSupabase(comment) {
  if (!isSupabaseEnabled() || !comment) return;
  const { error } = await sb.from('booth_comments').insert({
    id: comment.id,
    booth_id: Number(comment.boothId),
    visitor_id: comment.visitorId ? String(comment.visitorId).slice(0, 64) : null,
    name: String(comment.name || 'Delegate').slice(0, 24),
    body: String(comment.text || '').slice(0, 200),
    ts: new Date(comment.ts || Date.now()).toISOString(),
  });
  if (error) console.warn('[presence] comment insert:', error.message);
}

export function recordAnalyticsEvent({ type, boothId = null, visitorId = null, countryCode = null } = {}) {
  if (!isSupabaseEnabled() || !type) return;
  const row = {
    type: String(type),
    booth_id: boothId == null ? null : Number(boothId),
    visitor_id: visitorId ? String(visitorId).slice(0, 64) : null,
    country_code: countryCode ? String(countryCode).slice(0, 2).toUpperCase() : null,
  };
  sb.from('analytics_events').insert(row).then(({ error }) => {
    if (error) console.warn('[presence] event insert:', error.message);
    else trendCache.at = 0;
  });
}

/** Last 30 days daily buckets for the staff dashboard trend chart. */
export async function fetchTrend(days = 30) {
  if (!isSupabaseEnabled()) return [];
  const now = Date.now();
  if (now - trendCache.at < TREND_TTL_MS) return trendCache.data;

  const since = new Date(now - days * 86400000).toISOString();
  const { data, error } = await sb
    .from('analytics_events')
    .select('type, ts')
    .gte('ts', since);
  if (error) {
    console.warn('[presence] trend query:', error.message);
    return [];
  }

  const byDay = new Map();
  const dayKey = (iso) => String(iso).slice(0, 10);
  for (let i = 0; i < days; i++) {
    const d = new Date(now - (days - 1 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, {
      date: key,
      pageViews: 0,
      opens: 0,
      intros: 0,
      quizPlays: 0,
      quizPasses: 0,
      passports: 0,
    });
  }

  for (const row of data || []) {
    const key = dayKey(row.ts);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    switch (row.type) {
      case 'page_view': bucket.pageViews += 1; break;
      case 'booth_open': bucket.opens += 1; break;
      case 'intro_play': bucket.intros += 1; break;
      case 'quiz_play': bucket.quizPlays += 1; break;
      case 'quiz_pass': bucket.quizPasses += 1; break;
      case 'passport_complete': bucket.passports += 1; break;
      default: break;
    }
  }

  const result = [...byDay.values()];
  trendCache = { at: now, data: result };
  return result;
}
