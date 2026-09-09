-- Diplomatic Hall analytics / engagement (run in Supabase SQL Editor once).
-- Presence server uses the service role key; keep RLS on for anon.

-- Timestamped hall events (trends, funder reports)
CREATE TABLE IF NOT EXISTS analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type         TEXT NOT NULL,
  booth_id     INTEGER,
  visitor_id   TEXT,
  country_code CHAR(2)
);

CREATE INDEX IF NOT EXISTS analytics_events_ts_idx
  ON analytics_events (ts);
CREATE INDEX IF NOT EXISTS analytics_events_type_ts_idx
  ON analytics_events (type, ts);
CREATE INDEX IF NOT EXISTS analytics_events_country_idx
  ON analytics_events (country_code)
  WHERE country_code IS NOT NULL;

-- Fast counters snapshot (single row)
CREATE TABLE IF NOT EXISTS hall_analytics_totals (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  booth_opens          JSONB NOT NULL DEFAULT '{}'::jsonb,
  intro_plays          JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiz_plays           JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiz_passes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  unique_visitors      JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_views           INT NOT NULL DEFAULT 0,
  peak_concurrent      INT NOT NULL DEFAULT 0,
  passport_completions INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO hall_analytics_totals (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- Hearts: one row per visitor per booth
CREATE TABLE IF NOT EXISTS booth_hearts (
  booth_id   INTEGER NOT NULL CHECK (booth_id BETWEEN 1 AND 20),
  visitor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (booth_id, visitor_id)
);

CREATE INDEX IF NOT EXISTS booth_hearts_booth_idx ON booth_hearts (booth_id);

-- Comments left on booths
CREATE TABLE IF NOT EXISTS booth_comments (
  id         TEXT PRIMARY KEY,
  booth_id   INTEGER NOT NULL CHECK (booth_id BETWEEN 1 AND 20),
  visitor_id TEXT,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booth_comments_booth_ts_idx
  ON booth_comments (booth_id, ts DESC);

-- Service role bypasses RLS; lock down anon/authenticated by default.
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hall_analytics_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE booth_hearts ENABLE ROW LEVEL SECURITY;
ALTER TABLE booth_comments ENABLE ROW LEVEL SECURITY;
