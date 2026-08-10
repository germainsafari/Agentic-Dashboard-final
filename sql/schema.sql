-- Neon Postgres schema for director KPI snapshots.
-- Applied automatically on first sync/read via lib/db.ts, or manually:
--   npm run db:migrate

CREATE TABLE IF NOT EXISTS director_snapshots (
  director_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_meta (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  last_sync_at TIMESTAMPTZ,
  last_sync_duration_ms INTEGER,
  sync_error TEXT,
  offer_prep_bookmark_id INTEGER
);
