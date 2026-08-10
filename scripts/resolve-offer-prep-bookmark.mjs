/**
 * One-time helper: resolve "All Offer Prep projects" bookmark id via Scoro user token.
 *
 * Requires in .env:
 *   SCORO_USER_TOKEN
 *     — or —
 *   SCORO_USER_USERNAME + SCORO_USER_PASSWORD (service account)
 *
 * Usage: node scripts/resolve-offer-prep-bookmark.mjs
 */

import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").replace(/\r/g, "").split("\n")) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const base = process.env.COMPANY_BASE_URL?.replace(/\/$/, "");
const company = process.env.SCORO_COMPANY_ACCOUNT_ID || "admindagency";
const bookmarkName = process.env.SCORO_OFFER_PREP_BOOKMARK_NAME || "All Offer Prep projects";

if (!base) {
  console.error("COMPANY_BASE_URL is required");
  process.exit(1);
}

async function userToken() {
  if (process.env.SCORO_USER_TOKEN?.trim()) return process.env.SCORO_USER_TOKEN.trim();
  const username = process.env.SCORO_USER_USERNAME?.trim();
  const password = process.env.SCORO_USER_PASSWORD?.trim();
  if (!username || !password) return null;

  const res = await fetch(`${base}/userAuth/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lang: "eng",
      company_account_id: company,
      username,
      password,
      device_type: "server",
      device_name: "Agentic Dashboard",
      device_id: "agentic-dashboard-resolve-bookmark",
      request: {},
    }),
  });
  const json = await res.json();
  return json.status === "OK" ? json.data?.token : null;
}

function norm(s) {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

const token = await userToken();
if (!token) {
  console.error("Set SCORO_USER_TOKEN or SCORO_USER_USERNAME/PASSWORD in .env");
  process.exit(1);
}

const res = await fetch(`${base}/bookmarks/list`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    lang: "eng",
    company_account_id: company,
    user_token: token,
    request: { module: "projects" },
  }),
});

const json = await res.json();
if (json.status !== "OK") {
  console.error("bookmarks/list failed:", json.messages);
  process.exit(1);
}

const target = norm(bookmarkName);
const match = (json.data || []).find((b) => norm(b.title) === target);

if (!match) {
  console.log("Available project bookmarks:");
  for (const b of json.data || []) console.log(`  - "${b.title}" (${b.bookmark_id})`);
  console.error(`No exact match for "${bookmarkName}"`);
  process.exit(1);
}

console.log(`Matched: "${match.title}" → bookmark_id ${match.bookmark_id}`);
console.log(`\nAdd to Render/Vercel env:\nSCORO_OFFER_PREP_BOOKMARK_ID=${match.bookmark_id}`);
