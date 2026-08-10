import "server-only";

export type ScoroResponse<T = unknown> = {
  status?: string;
  statusCode?: number | string;
  data?: T;
  messages?: unknown;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT = 2;
const MAX_RETRIES = 3;

// These endpoints return large per-user lists during sync — caching them
// would double memory usage since we only need each page once per request.
const NO_CACHE_PATHS = new Set(["timeEntries/list", "tasks/list"]);

type CacheEntry<T> = { data: T; expiresAt: number };
const memCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const e = memCache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    memCache.delete(key);
    return undefined;
  }
  return e.data as T;
}

function cacheSet<T>(key: string, data: T): void {
  memCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

let inFlight = 0;
const queue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => queue.push(() => { inFlight++; resolve(); }));
}

function releaseSlot(): void {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function companyAccountIdFromEnv(): string {
  if (process.env.SCORO_COMPANY_ACCOUNT_ID) return process.env.SCORO_COMPANY_ACCOUNT_ID;
  const base = process.env.COMPANY_BASE_URL ?? "";
  try {
    const host = new URL(base).hostname;
    return host.split(".")[0] || "admindagency";
  } catch {
    return "admindagency";
  }
}

export async function scoroPost<T = unknown>(
  path: string,
  body: Record<string, unknown>
): Promise<ScoroResponse<T> | null> {
  const base = process.env.COMPANY_BASE_URL;
  const key = process.env.SCORO_API_KEY;
  if (!base || !key) return null;

  const skipCache = NO_CACHE_PATHS.has(path);
  const cacheKey = skipCache ? "" : JSON.stringify({ path, body });
  if (!skipCache) {
    const cached = cacheGet<ScoroResponse<T>>(cacheKey);
    if (cached) return cached;
  }

  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const payload = {
    lang: "eng",
    company_account_id: companyAccountIdFromEnv(),
    apiKey: key,
    ...body,
  };

  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: AbortSignal.timeout(45_000),
        });

        if (res.status === 429) {
          const wait = Math.min(2000 * Math.pow(2, attempt), 15_000);
          console.warn(`[scoro] ${path} 429 — waiting ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
          await sleep(wait);
          continue;
        }

        const json = (await res.json()) as ScoroResponse<T>;
        if (!res.ok || json.status === "ERROR") {
          console.warn(`[scoro] ${path} HTTP ${res.status}`, json.messages);
          return null;
        }
        if (!skipCache) cacheSet(cacheKey, json);
        return json;
      } catch (e) {
        if (attempt === MAX_RETRIES) {
          console.warn(`[scoro] ${path} failed after ${MAX_RETRIES + 1} attempts:`, e);
          return null;
        }
        const wait = 2000 * Math.pow(2, attempt);
        console.warn(`[scoro] ${path} error, retrying in ${wait}ms:`, e);
        await sleep(wait);
      }
    }
    return null;
  } finally {
    releaseSlot();
  }
}

export function clearApiCache(): void {
  memCache.clear();
  cachedUserToken = undefined;
}

let cachedUserToken: string | null | undefined;

/**
 * User token for Scoro endpoints that reject company apiKey (e.g. bookmarks/list).
 * Set SCORO_USER_TOKEN directly, or SCORO_USER_USERNAME + SCORO_USER_PASSWORD
 * for a dedicated service account (login via userAuth/modify once per sync run).
 */
export async function resolveScoroUserToken(): Promise<string | null> {
  if (cachedUserToken !== undefined) return cachedUserToken;

  const direct = process.env.SCORO_USER_TOKEN?.trim();
  if (direct) {
    cachedUserToken = direct;
    return direct;
  }

  const username = process.env.SCORO_USER_USERNAME?.trim();
  const password = process.env.SCORO_USER_PASSWORD?.trim();
  if (!username || !password) {
    cachedUserToken = null;
    return null;
  }

  const base = process.env.COMPANY_BASE_URL;
  if (!base) {
    cachedUserToken = null;
    return null;
  }

  const url = `${base.replace(/\/$/, "")}/userAuth/modify`;
  const payload = {
    lang: "eng",
    company_account_id: companyAccountIdFromEnv(),
    username,
    password,
    device_type: "server",
    device_name: "Agentic Dashboard",
    device_id: "agentic-dashboard-sync",
    request: {},
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const json = (await res.json()) as ScoroResponse<{ token?: string }>;
    const token =
      json.status === "OK" && json.data && typeof json.data.token === "string"
        ? json.data.token
        : null;
    if (!token) {
      console.warn("[scoro] userAuth/modify failed:", json.messages);
    }
    cachedUserToken = token;
    return token;
  } catch (e) {
    console.warn("[scoro] userAuth/modify error:", e);
    cachedUserToken = null;
    return null;
  }
}

/** POST using user_token (required for bookmarks/list and bookmark_id project filters). */
export async function scoroPostUser<T = unknown>(
  path: string,
  body: Record<string, unknown>
): Promise<ScoroResponse<T> | null> {
  const token = await resolveScoroUserToken();
  if (!token) return null;

  const base = process.env.COMPANY_BASE_URL;
  if (!base) return null;

  const skipCache = NO_CACHE_PATHS.has(path);
  const cacheKey = skipCache ? "" : `user:${JSON.stringify({ path, body })}`;
  if (!skipCache) {
    const cached = cacheGet<ScoroResponse<T>>(cacheKey);
    if (cached) return cached;
  }

  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const payload = {
    lang: "eng",
    company_account_id: companyAccountIdFromEnv(),
    user_token: token,
    ...body,
  };

  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: AbortSignal.timeout(45_000),
        });

        if (res.status === 429) {
          const wait = Math.min(2000 * Math.pow(2, attempt), 15_000);
          console.warn(`[scoro:user] ${path} 429 — waiting ${wait}ms`);
          await sleep(wait);
          continue;
        }

        const json = (await res.json()) as ScoroResponse<T>;
        if (!res.ok || json.status === "ERROR") {
          console.warn(`[scoro:user] ${path} HTTP ${res.status}`, json.messages);
          return null;
        }
        if (!skipCache) cacheSet(cacheKey, json);
        return json;
      } catch (e) {
        if (attempt === MAX_RETRIES) {
          console.warn(`[scoro:user] ${path} failed after ${MAX_RETRIES + 1} attempts:`, e);
          return null;
        }
        await sleep(2000 * Math.pow(2, attempt));
      }
    }
    return null;
  } finally {
    releaseSlot();
  }
}

export async function scoroListAllPagesUser<T extends Record<string, unknown>>(
  path: string,
  options: {
    filter?: Record<string, unknown>;
    bookmark?: Record<string, unknown>;
    detailed?: boolean;
    maxPages?: number;
  }
): Promise<T[]> {
  const skipCache = NO_CACHE_PATHS.has(path);
  const listCacheKey = skipCache ? "" : `userlist:${JSON.stringify({ path, options })}`;
  if (!skipCache) {
    const cached = cacheGet<T[]>(listCacheKey);
    if (cached) return cached;
  }

  const out: T[] = [];
  const maxPages = options.maxPages ?? 80;
  const perPage = options.detailed ? 25 : 100;

  for (let page = 1; page <= maxPages; page++) {
    const body: Record<string, unknown> = {
      per_page: perPage,
      page,
      request: {},
    };
    if (options.detailed) body.detailed_response = true;
    if (options.filter) body.filter = options.filter;
    if (options.bookmark) body.bookmark = options.bookmark;

    const res = await scoroPostUser<T[]>(path, body);
    const chunk = Array.isArray(res?.data) ? (res!.data as T[]) : [];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < perPage) break;
  }
  if (!skipCache) cacheSet(listCacheKey, out);
  return out;
}

export async function scoroListAllPages<T extends Record<string, unknown>>(
  path: string,
  options: {
    filter?: Record<string, unknown>;
    bookmark?: Record<string, unknown>;
    detailed?: boolean;
    maxPages?: number;
  }
): Promise<T[]> {
  const skipCache = NO_CACHE_PATHS.has(path);
  const listCacheKey = skipCache ? "" : `list:${JSON.stringify({ path, options })}`;
  if (!skipCache) {
    const cached = cacheGet<T[]>(listCacheKey);
    if (cached) return cached;
  }

  const out: T[] = [];
  const maxPages = options.maxPages ?? 80;
  const perPage = options.detailed ? 25 : 100;

  for (let page = 1; page <= maxPages; page++) {
    const body: Record<string, unknown> = {
      per_page: perPage,
      page,
      request: {},
    };
    if (options.detailed) body.detailed_response = true;
    if (options.filter) body.filter = options.filter;
    if (options.bookmark) body.bookmark = options.bookmark;

    const res = await scoroPost<T[]>(path, body);
    const chunk = Array.isArray(res?.data) ? (res!.data as T[]) : [];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < perPage) break;
  }
  if (!skipCache) cacheSet(listCacheKey, out);
  return out;
}
