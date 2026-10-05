/**
 * Admin API — booth content management via Supabase.
 * Mounted onto the existing HTTP server in presence.js.
 * All routes require the same ANALYTICS_TOKEN for auth.
 */
import { createClient } from '@supabase/supabase-js';

const URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || ''
).trim();

let sb = null;
let adminReady = false;

export async function initAdmin() {
  if (!URL || !KEY) {
    console.log('[admin] Supabase unset — admin dashboard disabled');
    return false;
  }
  try {
    sb = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Verify booths table exists
    const { error } = await sb.from('booths').select('id').limit(1);
    if (error) {
      console.warn('[admin] booths table not found:', error.message);
      console.warn('[admin] Run server/admin-schema.sql in the Supabase SQL Editor, then restart.');
      sb = null;
      return false;
    }
    adminReady = true;
    console.log('[admin] Admin API ready');
    return true;
  } catch (err) {
    console.warn('[admin] init failed:', err.message);
    sb = null;
    return false;
  }
}

export function isAdminReady() {
  return adminReady && !!sb;
}

function corsJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
  });
  res.end(status === 204 ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Handle admin API requests.
 * Returns true if the request was handled, false to fall through.
 */
export async function handleAdminRequest(req, res, url, token) {
  const path = url.pathname;

  // Only handle /admin-api/* routes
  if (!path.startsWith('/admin-api')) return false;

  if (req.method === 'OPTIONS') {
    corsJson(res, 204, {});
    return true;
  }

  // Password/token check removed per configuration (open for admin)
  if (!isAdminReady()) {
    await initAdmin();
  }
  if (!isAdminReady()) {
    corsJson(res, 503, { ok: false, error: 'admin_not_ready' });
    return true;
  }

  try {
    // GET /admin-api/booths — list all booths
    if (path === '/admin-api/booths' && req.method === 'GET') {
      const { data, error } = await sb.from('booths')
        .select('*')
        .order('id', { ascending: true });
      if (error) throw error;
      corsJson(res, 200, { ok: true, booths: data || [] });
      return true;
    }

    // GET /admin-api/booths/:id — single booth
    const singleMatch = path.match(/^\/admin-api\/booths\/(\d+)$/);
    if (singleMatch && req.method === 'GET') {
      const id = Number(singleMatch[1]);
      const { data, error } = await sb.from('booths')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        corsJson(res, 404, { ok: false, error: 'not_found' });
        return true;
      }
      corsJson(res, 200, { ok: true, booth: data });
      return true;
    }

    // PUT /admin-api/booths/:id — update or upsert a booth
    if (singleMatch && req.method === 'PUT') {
      const id = Number(singleMatch[1]);
      if (id < 1 || id > 30) {
        corsJson(res, 400, { ok: false, error: 'invalid_booth_id' });
        return true;
      }
      const body = await readBody(req);
      if (!body) {
        corsJson(res, 400, { ok: false, error: 'invalid_body' });
        return true;
      }
      // Allowed fields
      const allowed = [
        'name', 'category', 'organization', 'theme', 'overview',
        'logo', 'intro_video', 'images', 'stats', 'links',
        'socials', 'contact', 'quiz', 'placeholder',
      ];
      const update = { id, updated_at: new Date().toISOString() };
      for (const key of allowed) {
        if (key in body) update[key] = body[key];
      }
      const { data, error } = await sb.from('booths')
        .upsert(update, { onConflict: 'id' })
        .select()
        .maybeSingle();
      if (error) throw error;
      corsJson(res, 200, { ok: true, booth: data });
      return true;
    }

    // POST /admin-api/booths/sync — export booths.json from DB
    if (path === '/admin-api/booths/sync' && req.method === 'POST') {
      const { data, error } = await sb.from('booths')
        .select('*')
        .order('id', { ascending: true });
      if (error) throw error;
      // Transform DB rows to the booths.json format
      const boothsJson = (data || []).map((row) => ({
        id: row.id,
        name: row.name || '',
        category: row.category || '',
        logo: row.logo || '',
        images: row.images || [],
        overview: row.overview || '',
        introVideo: row.intro_video || '',
        stats: row.stats || [],
        links: row.links || [],
        socials: row.socials || {},
        contact: row.contact || {},
        placeholder: row.placeholder ?? true,
        quiz: row.quiz || {},
        organization: row.organization || '',
        theme: row.theme || '',
      }));
      corsJson(res, 200, { ok: true, booths: boothsJson });
      return true;
    }

    // POST /admin-api/booths/import — import current booths.json into DB
    if (path === '/admin-api/booths/import' && req.method === 'POST') {
      const body = await readBody(req);
      const booths = body?.booths;
      if (!Array.isArray(booths)) {
        corsJson(res, 400, { ok: false, error: 'expected booths array' });
        return true;
      }
      let imported = 0;
      for (const b of booths) {
        if (!b.id || b.id < 1 || b.id > 30) continue;
        const row = {
          id: b.id,
          name: b.name || '',
          category: b.category || '',
          organization: b.organization || '',
          theme: b.theme || '',
          overview: b.overview || '',
          logo: b.logo || '',
          intro_video: b.introVideo || b.intro_video || '',
          images: b.images || [],
          stats: b.stats || [],
          links: b.links || [],
          socials: b.socials || {},
          contact: b.contact || {},
          quiz: b.quiz || {},
          placeholder: b.placeholder ?? true,
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from('booths').upsert(row, { onConflict: 'id' });
        if (!error) imported++;
      }
      corsJson(res, 200, { ok: true, imported });
      return true;
    }

    // POST /admin-api/upload — upload file to booth-media bucket
    if (path === '/admin-api/upload' && req.method === 'POST') {
      // Read raw binary body
      const chunks = [];
      await new Promise((resolve) => {
        req.on('data', (c) => chunks.push(c));
        req.on('end', resolve);
      });
      const buffer = Buffer.concat(chunks);
      const fileName = url.searchParams.get('name') || `upload-${Date.now()}`;
      const contentType = req.headers['content-type'] || 'application/octet-stream';

      const { data, error } = await sb.storage
        .from('booth-media')
        .upload(fileName, buffer, {
          contentType,
          upsert: true,
        });
      if (error) throw error;
      const { data: urlData } = sb.storage.from('booth-media').getPublicUrl(fileName);
      corsJson(res, 200, { ok: true, path: data?.path, publicUrl: urlData?.publicUrl });
      return true;
    }

    // DELETE /admin-api/upload — delete a file from booth-media
    if (path === '/admin-api/upload' && req.method === 'DELETE') {
      const body = await readBody(req);
      const filePath = body?.path;
      if (!filePath) {
        corsJson(res, 400, { ok: false, error: 'missing path' });
        return true;
      }
      const { error } = await sb.storage.from('booth-media').remove([filePath]);
      if (error) throw error;
      corsJson(res, 200, { ok: true });
      return true;
    }

    // GET /admin-api/files — list files in booth-media bucket
    if (path === '/admin-api/files' && req.method === 'GET') {
      const folder = url.searchParams.get('folder') || '';
      const { data, error } = await sb.storage
        .from('booth-media')
        .list(folder, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      corsJson(res, 200, { ok: true, files: data || [] });
      return true;
    }

  } catch (err) {
    console.error('[admin] API error:', err.message);
    corsJson(res, 500, { ok: false, error: err.message });
    return true;
  }

  corsJson(res, 404, { ok: false, error: 'unknown_admin_route' });
  return true;
}
