import "server-only";

import { neon } from "@neondatabase/serverless";

let schemaReady: Promise<void> | null = null;

export function isDatabaseEnabled(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

function getSql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/** Create tables on first use (idempotent). */
export async function ensureDatabaseSchema(): Promise<void> {
  if (!isDatabaseEnabled()) return;
  if (!schemaReady) {
    schemaReady = runEnsureSchema();
  }
  await schemaReady;
}

async function runEnsureSchema(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS director_snapshots (
      director_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sync_meta (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      last_sync_at TIMESTAMPTZ,
      last_sync_duration_ms INTEGER,
      sync_error TEXT,
      offer_prep_bookmark_id INTEGER
    )
  `;

  console.log("[db] Schema ready");
}

export { getSql };
