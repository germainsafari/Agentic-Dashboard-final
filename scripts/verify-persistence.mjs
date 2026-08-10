/**
 * Audit persistent stores + optional cron smoke test (no secrets printed).
 */
import fs from "node:fs";
import https from "node:https";
import { neon } from "@neondatabase/serverless";
import { Redis } from "@upstash/redis";

for (const line of fs.readFileSync(".env", "utf8").replace(/\r/g, "").split("\n")) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const DIRECTORS = [
  "piotr",
  "marta",
  "dominika",
  "michal",
  "karolina",
  "jonattas",
  "krzysztof",
  "maciej",
  "justyna",
];

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers, timeout: 120_000 }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

const report = {
  env: {
    databaseConfigured: !!process.env.DATABASE_URL?.trim(),
    redisConfigured: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    cronSecretConfigured: !!process.env.CRON_SECRET?.trim(),
    scoroConfigured: !!(process.env.SCORO_API_KEY && process.env.COMPANY_BASE_URL),
  },
  postgres: null,
  redis: null,
  deployedSyncStatus: null,
  cronSmoke: null,
};

if (report.env.databaseConfigured) {
  const sql = neon(process.env.DATABASE_URL);
  const countRows = await sql`SELECT COUNT(*)::int AS count FROM director_snapshots`;
  const metaRows = await sql`
    SELECT last_sync_at, last_sync_duration_ms, sync_error
    FROM sync_meta WHERE id = 1 LIMIT 1
  `;
  const perDirector = await sql`
    SELECT director_id, fetched_at, updated_at
    FROM director_snapshots
    ORDER BY director_id
  `;
  report.postgres = {
    directorCount: countRows[0]?.count ?? 0,
    meta: metaRows[0] ?? null,
    directors: perDirector.map((r) => ({
      id: r.director_id,
      fetchedAt: r.fetched_at,
      updatedAt: r.updated_at,
      ageHours: r.fetched_at
        ? +((Date.now() - new Date(r.fetched_at).getTime()) / 3_600_000).toFixed(1)
        : null,
    })),
    missingDirectors: DIRECTORS.filter(
      (id) => !perDirector.some((r) => r.director_id === id)
    ),
  };
}

if (report.env.redisConfigured) {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  const keys = await Promise.all(
    DIRECTORS.map(async (id) => {
      const val = await redis.get(`snapshot:${id}`);
      return { id, present: val != null, fetchedAt: val?.fetchedAt ?? null };
    })
  );
  const meta = await redis.get("sync:meta");
  report.redis = {
    snapshotKeysPresent: keys.filter((k) => k.present).length,
    directors: keys,
    meta,
  };
}

const base =
  process.env.APP_BASE_URL?.replace(/\/$/, "") ??
  "https://agentic-dashboard.onrender.com";

try {
  const syncRes = await httpGet(`${base}/api/sync`);
  report.deployedSyncStatus = {
    url: `${base}/api/sync`,
    status: syncRes.status,
    body: JSON.parse(syncRes.body),
  };
} catch (e) {
  report.deployedSyncStatus = { error: e instanceof Error ? e.message : String(e) };
}

// Cron auth probe (no sync) unless RUN_CRON_SMOKE=1 — full sync can take 5–10 min
try {
  const secret = process.env.CRON_SECRET?.trim();
  const badHeaders = secret ? { Authorization: "Bearer invalid-token" } : {};
  const badRes = await httpGet(`${base}/api/cron?director=marta`, badHeaders);
  report.cronAuth = {
    url: `${base}/api/cron`,
    unauthorizedStatus: badRes.status,
    authRequired: secret ? badRes.status === 401 : "no CRON_SECRET locally",
  };

  if (process.env.RUN_CRON_SMOKE === "1") {
    const headers = secret ? { Authorization: `Bearer ${secret}` } : {};
    const cronRes = await httpGet(`${base}/api/cron?director=marta`, headers);
    let parsed;
    try {
      parsed = JSON.parse(cronRes.body);
    } catch {
      parsed = cronRes.body.slice(0, 300);
    }
    report.cronSmoke = {
      url: `${base}/api/cron?director=marta`,
      status: cronRes.status,
      body: parsed,
    };
  }
} catch (e) {
  report.cronAuth = { error: e instanceof Error ? e.message : String(e) };
}

console.log(JSON.stringify(report, null, 2));
