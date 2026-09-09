/**
 * Quick check that .env Supabase credentials work.
 * Usage: node scripts/verify-supabase.mjs
 */
import '../server/load-env.mjs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const { error } = await sb.from('hall_analytics_totals').select('id').limit(1);

if (!error) {
  console.log('OK — Supabase connected; schema is present.');
  process.exit(0);
}

if (/schema cache|does not exist|Could not find the table/i.test(error.message)) {
  console.error('Credentials work, but tables are missing.');
  console.error('Open Supabase → SQL Editor → paste server/schema.sql → Run.');
  console.error('Then re-run: node scripts/verify-supabase.mjs');
  process.exit(2);
}

console.error('Supabase error:', error.message);
process.exit(1);
