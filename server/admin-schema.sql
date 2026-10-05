-- Admin dashboard: booth content management (run in Supabase SQL Editor once).
-- Stores booth metadata that was previously hard-coded in src/data/booths.json.

CREATE TABLE IF NOT EXISTS booths (
  id              INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 30),
  name            TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  organization    TEXT NOT NULL DEFAULT '',
  theme           TEXT NOT NULL DEFAULT '',
  overview        TEXT NOT NULL DEFAULT '',
  logo            TEXT NOT NULL DEFAULT '',
  intro_video     TEXT NOT NULL DEFAULT '',
  images          JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats           JSONB NOT NULL DEFAULT '[]'::jsonb,
  links           JSONB NOT NULL DEFAULT '[]'::jsonb,
  socials         JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact         JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiz            JSONB NOT NULL DEFAULT '{}'::jsonb,
  placeholder     BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If table was already created with the old 1..24 constraint, update it to allow 1..30:
ALTER TABLE booths DROP CONSTRAINT IF EXISTS booths_id_check;
ALTER TABLE booths ADD CONSTRAINT booths_id_check CHECK (id BETWEEN 1 AND 30);

-- Service role bypasses RLS; no anon access to admin data.
ALTER TABLE booths ENABLE ROW LEVEL SECURITY;

-- Seed all 27 booths (24 youth booths + 3 organizer booths: TdH, KNH, VEWU)
INSERT INTO booths (id) VALUES
  (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),
  (13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23),(24),
  (25),(26),(27)
ON CONFLICT (id) DO NOTHING;

-- Storage bucket for booth media (logos, images, videos).
-- Create via Supabase Dashboard > Storage > New Bucket:
--   Name: booth-media
--   Public: true (so the game client can load images)
--   File size limit: 50MB
--
-- Or via SQL:
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('booth-media', 'booth-media', true, 52428800)
ON CONFLICT (id) DO NOTHING;
