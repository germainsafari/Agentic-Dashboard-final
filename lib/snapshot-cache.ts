import "server-only";

import { snapshotKvTtlSeconds } from "./sync-schedule";
import {
  isDatabaseEnabled,
  persistentStoreLabel,
  pgCountDirectors,
  pgGetDirector,
  pgReadMeta,
  pgSetDirector,
  pgWriteMeta,
} from "./snapshot-postgres";

export type { DirectorCacheEntry, SyncMeta } from "./snapshot-types";
import type { DirectorCacheEntry, SyncMeta } from "./snapshot-types";

// ── Backend detection ──────────────────────────────────────────────────────
// Postgres (Neon) — primary persistent store when DATABASE_URL is set.
// Upstash Redis — legacy fallback when KV env vars are set without Postgres.
const KV_ENABLED = !!(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);

const KV_DIR_PREFIX = "snapshot:";
const KV_META_KEY = "sync:meta";

function kvTtlSeconds(): number {
  return snapshotKvTtlSeconds();
}

export function isPersistentCacheEnabled(): boolean {
  return isDatabaseEnabled() || KV_ENABLED;
}

export function getPersistentStoreLabel(): string {
  return persistentStoreLabel() ?? (KV_ENABLED ? "redis" : "file");
}

// ── Upstash Redis helpers (legacy fallback) ────────────────────────────────

function getRedis() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  return redis.get<T>(key);
}

async function kvSet(key: string, value: unknown, ex?: number): Promise<void> {
  const redis = getRedis();
  if (ex) {
    await redis.set(key, value, { ex });
  } else {
    await redis.set(key, value);
  }
}

// ── File-system helpers (local development only) ────────────────────────────

type LegacyFileShape = {
  directors?: Record<string, DirectorCacheEntry>;
  lastSyncAt?: string | null;
  lastSyncDurationMs?: number | null;
  syncError?: string | null;
};

function getFilePath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  return path.join(process.cwd(), "data", "cache.json");
}

function fileRead(): { directors: Record<string, DirectorCacheEntry>; meta: SyncMeta } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    const raw = fs.readFileSync(getFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as LegacyFileShape;
    return {
      directors: parsed.directors ?? {},
      meta: {
        lastSyncAt: parsed.lastSyncAt ?? null,
        lastSyncDurationMs: parsed.lastSyncDurationMs ?? null,
        syncError: parsed.syncError ?? null,
      },
    };
  } catch {
    return {
      directors: {},
      meta: { lastSyncAt: null, lastSyncDurationMs: null, syncError: null },
    };
  }
}

function fileWriteAll(data: {
  directors: Record<string, DirectorCacheEntry>;
  meta: SyncMeta;
}): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const fp = getFilePath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      fp,
      JSON.stringify({ ...data.meta, directors: data.directors }, null, 2),
      "utf-8"
    );
  } catch (e) {
    console.warn("[cache] File write failed:", e);
  }
}

// ── In-memory cache (fastest layer; survives between requests in same process) ─
const memCache = new Map<string, DirectorCacheEntry>();
let memMeta: SyncMeta | null = null;

function invalidateDirectorMemory(directorId: string): void {
  memCache.delete(directorId);
}

// ── Public API (all async) ─────────────────────────────────────────────────

export async function getCachedDirector(
  directorId: string
): Promise<DirectorCacheEntry | null> {
  if (memCache.has(directorId)) return memCache.get(directorId)!;

  if (isDatabaseEnabled()) {
    const entry = await pgGetDirector(directorId);
    if (entry) memCache.set(directorId, entry);
    return entry;
  }

  if (KV_ENABLED) {
    const entry = await kvGet<DirectorCacheEntry>(`${KV_DIR_PREFIX}${directorId}`);
    if (entry) memCache.set(directorId, entry);
    return entry;
  }

  const entry = fileRead().directors[directorId] ?? null;
  if (entry) memCache.set(directorId, entry);
  return entry;
}

export async function setCachedDirector(entry: DirectorCacheEntry): Promise<void> {
  memCache.set(entry.directorId, entry);

  if (isDatabaseEnabled()) {
    await pgSetDirector(entry);
    console.log(`[cache] ${entry.directorId} snapshot saved to Postgres`);
    return;
  }

  if (KV_ENABLED) {
    await kvSet(`${KV_DIR_PREFIX}${entry.directorId}`, entry, kvTtlSeconds());
    return;
  }

  const current = fileRead();
  current.directors[entry.directorId] = entry;
  fileWriteAll(current);
}

export async function readMeta(): Promise<SyncMeta> {
  if (memMeta) return memMeta;

  if (isDatabaseEnabled()) {
    const m = (await pgReadMeta()) ?? {
      lastSyncAt: null,
      lastSyncDurationMs: null,
      syncError: null,
    };
    memMeta = m;
    return m;
  }

  if (KV_ENABLED) {
    const m = (await kvGet<SyncMeta>(KV_META_KEY)) ?? {
      lastSyncAt: null,
      lastSyncDurationMs: null,
      syncError: null,
    };
    memMeta = m;
    return m;
  }

  const m = fileRead().meta;
  memMeta = m;
  return m;
}

export async function writeMeta(meta: SyncMeta): Promise<void> {
  memMeta = meta;

  if (isDatabaseEnabled()) {
    await pgWriteMeta(meta);
    return;
  }

  if (KV_ENABLED) {
    await kvSet(KV_META_KEY, meta, kvTtlSeconds());
    return;
  }

  const current = fileRead();
  current.meta = meta;
  fileWriteAll(current);
}

export async function countCachedDirectors(): Promise<number> {
  if (isDatabaseEnabled()) {
    return pgCountDirectors();
  }

  if (KV_ENABLED) {
    const { allResolvedDirectors } = await import("./directors");
    const dirs = allResolvedDirectors();
    const results = await Promise.all(
      dirs.map((d) => kvGet<DirectorCacheEntry>(`${KV_DIR_PREFIX}${d.id}`))
    );
    return results.filter(Boolean).length;
  }

  return Object.keys(fileRead().directors).length;
}

export async function cacheAge(): Promise<{ lastSyncAt: string | null; ageMs: number | null }> {
  const meta = await readMeta();
  if (!meta.lastSyncAt) return { lastSyncAt: null, ageMs: null };
  return {
    lastSyncAt: meta.lastSyncAt,
    ageMs: Date.now() - new Date(meta.lastSyncAt).getTime(),
  };
}

/** Clear in-process cache (e.g. after external refresh). */
export function clearMemoryCache(directorId?: string): void {
  if (directorId) {
    invalidateDirectorMemory(directorId);
    return;
  }
  memCache.clear();
  memMeta = null;
}
