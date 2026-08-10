import "server-only";

import type { DirectorCacheEntry, SyncMeta } from "./snapshot-types";
import { ensureDatabaseSchema, getSql, isDatabaseEnabled } from "./db";

export { isDatabaseEnabled };

export async function pgGetDirector(
  directorId: string
): Promise<DirectorCacheEntry | null> {
  if (!isDatabaseEnabled()) return null;
  await ensureDatabaseSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT payload
    FROM director_snapshots
    WHERE director_id = ${directorId}
    LIMIT 1
  `;
  const row = rows[0] as { payload: DirectorCacheEntry } | undefined;
  return row?.payload ?? null;
}

/** Replace the full director snapshot (upsert on refresh). */
export async function pgSetDirector(entry: DirectorCacheEntry): Promise<void> {
  if (!isDatabaseEnabled()) return;
  await ensureDatabaseSchema();
  const sql = getSql();
  await sql`
    INSERT INTO director_snapshots (director_id, payload, fetched_at, updated_at)
    VALUES (
      ${entry.directorId},
      ${JSON.stringify(entry)}::jsonb,
      ${entry.fetchedAt}::timestamptz,
      NOW()
    )
    ON CONFLICT (director_id) DO UPDATE SET
      payload = EXCLUDED.payload,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = NOW()
  `;
}

export async function pgReadMeta(): Promise<SyncMeta | null> {
  if (!isDatabaseEnabled()) return null;
  await ensureDatabaseSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      last_sync_at,
      last_sync_duration_ms,
      sync_error,
      offer_prep_bookmark_id
    FROM sync_meta
    WHERE id = 1
    LIMIT 1
  `;
  const row = rows[0] as
    | {
        last_sync_at: string | null;
        last_sync_duration_ms: number | null;
        sync_error: string | null;
        offer_prep_bookmark_id: number | null;
      }
    | undefined;
  if (!row) {
    return {
      lastSyncAt: null,
      lastSyncDurationMs: null,
      syncError: null,
      offerPrepBookmarkId: null,
    };
  }
  return {
    lastSyncAt: row.last_sync_at,
    lastSyncDurationMs: row.last_sync_duration_ms,
    syncError: row.sync_error,
    offerPrepBookmarkId: row.offer_prep_bookmark_id,
  };
}

/** Replace sync metadata singleton row. */
export async function pgWriteMeta(meta: SyncMeta): Promise<void> {
  if (!isDatabaseEnabled()) return;
  await ensureDatabaseSchema();
  const sql = getSql();
  await sql`
    INSERT INTO sync_meta (
      id,
      last_sync_at,
      last_sync_duration_ms,
      sync_error,
      offer_prep_bookmark_id
    )
    VALUES (
      1,
      ${meta.lastSyncAt}::timestamptz,
      ${meta.lastSyncDurationMs},
      ${meta.syncError},
      ${meta.offerPrepBookmarkId ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      last_sync_at = EXCLUDED.last_sync_at,
      last_sync_duration_ms = EXCLUDED.last_sync_duration_ms,
      sync_error = EXCLUDED.sync_error,
      offer_prep_bookmark_id = EXCLUDED.offer_prep_bookmark_id
  `;
}

export async function pgCountDirectors(): Promise<number> {
  if (!isDatabaseEnabled()) return 0;
  await ensureDatabaseSchema();
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*)::int AS count FROM director_snapshots`;
  const row = rows[0] as { count: number } | undefined;
  return row?.count ?? 0;
}

export function persistentStoreLabel(): string | null {
  if (isDatabaseEnabled()) return "postgres";
  return null;
}
