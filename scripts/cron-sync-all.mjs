/**
 * Render cron runner: sync every director sequentially via the web service.
 *
 * Uses POST /api/sync (returns 202 immediately) then polls GET /api/sync so
 * long Scoro refreshes are not cut off by Render's HTTP request timeout.
 *
 * Env:
 *   APP_BASE_URL     — set automatically on Render via render.yaml fromService
 *   CRON_SECRET      — must match the web service (recommended in production)
 *   CRON_DIRECTORS   — optional comma list to sync a subset (e.g. piotr,marta)
 */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

try {
  for (const line of fs.readFileSync(".env", "utf8").replace(/\r/g, "").split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
} catch {
  // optional — Render injects env directly
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

const PAUSE_MS = 60_000;
const POLL_MS = 30_000;
/** Per-director Scoro sync can take up to ~45 min on Render free tier. */
const SYNC_WAIT_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 120_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpRequest(method, url, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      { method, headers, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: text,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

let base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
if (base && !/^https?:\/\//i.test(base)) {
  base = `https://${base}`;
}

const secret = process.env.CRON_SECRET?.trim();

if (!base) {
  console.error(
    "[cron-sync] APP_BASE_URL is required (Render sets this from the web service host)"
  );
  process.exit(1);
}

const headers = secret ? { Authorization: `Bearer ${secret}` } : {};

const directors = process.env.CRON_DIRECTORS?.trim()
  ? process.env.CRON_DIRECTORS.split(",").map((d) => d.trim()).filter(Boolean)
  : DIRECTORS;

async function fetchSyncStatus() {
  const res = await httpRequest("GET", `${base}/api/sync`, headers);
  if (!res.ok) {
    throw new Error(`GET /api/sync → HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }
  return JSON.parse(res.body);
}

async function waitForDirectorSync(director) {
  const deadline = Date.now() + SYNC_WAIT_MS;
  while (Date.now() < deadline) {
    const status = await fetchSyncStatus();
    if (!status.running) {
      if (status.syncError) {
        throw new Error(`Sync failed: ${status.syncError}`);
      }
      return status;
    }
    console.log(`[cron-sync]   ${director} still running… (${status.directorsCached} cached)`);
    await sleep(POLL_MS);
  }
  throw new Error(`Sync for ${director} did not finish within ${SYNC_WAIT_MS / 60000} min`);
}

console.log(`[cron-sync] Target: ${base}`);

for (const director of directors) {
  console.log(`[cron-sync] Triggering ${director}…`);
  const trigger = await httpRequest(
    "POST",
    `${base}/api/sync?director=${encodeURIComponent(director)}`,
    headers
  );
  console.log(
    `[cron-sync] ${director} trigger → HTTP ${trigger.status}: ${trigger.body.slice(0, 200)}`
  );
  if (trigger.status !== 202 && trigger.status !== 409) {
    process.exit(1);
  }
  if (trigger.status === 409) {
    console.log(`[cron-sync] ${director} skipped — sync already in progress, waiting…`);
  }

  const status = await waitForDirectorSync(director);
  console.log(
    `[cron-sync] ${director} done — lastSyncAt=${status.lastSyncAt}, cached=${status.directorsCached}`
  );

  if (director !== directors[directors.length - 1]) {
    await sleep(PAUSE_MS);
  }
}

console.log("[cron-sync] All directors synced.");
