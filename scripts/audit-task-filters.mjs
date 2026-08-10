import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID;
const leadId = 179;
const year = 2026;

async function auth() {
  const res = await fetch(`${base}/userAuth/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lang: "eng",
      company_account_id: companyId,
      username: process.env.SCORO_USER_USERNAME,
      password: process.env.SCORO_USER_PASSWORD,
      device_type: "server",
      device_name: "audit",
      device_id: "audit",
      request: {},
    }),
  });
  const json = await res.json();
  return json.data?.token ?? null;
}

async function post(path, body, token) {
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lang: "eng",
      company_account_id: companyId,
      ...(token ? { user_token: token } : { apiKey }),
      ...body,
    }),
  });
  const json = await res.json();
  if (json.status !== "OK" && json.statusCode !== 200 && json.statusCode !== "200") {
    throw new Error(`${path}: ${JSON.stringify(json.messages ?? json)}`);
  }
  return json.data ?? [];
}

async function list(path, filter, token) {
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const rows = await post(path, { filter, detailed_response: true, per_page: 100, page, request: {} }, token);
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

function assignees(t) {
  const ids = [];
  const add = (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n); };
  for (const a of t.assignees ?? t.doers ?? []) {
    if (typeof a === "number") add(a);
    else if (a && typeof a === "object") add(a.user_id ?? a.userId ?? a.id);
  }
  add(t.responsible_user_id ?? t.responsibleUserId);
  add(t.user_id);
  return ids;
}

function open(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return false;
  if (t.isDone === false) return true;
  const blob = `${t.status ?? ""} ${t.status_name ?? t.statusName ?? ""}`.toLowerCase();
  return !/\b(completed|done|invoiced)\b/.test(blob);
}

async function main() {
  const token = await auth();
  console.log("user token:", token ? "ok" : "missing");

  const filters = [
    { doer_id: leadId },
    { user_id: leadId },
    { doer_id: leadId, is_completed: 0 },
    { user_id: leadId, is_completed: 0 },
    { responsible_id: leadId, is_completed: 0 },
    { modified_date: { from_date: `${year}-01-01`, to_date: `${year}-12-31` }, doer_id: leadId },
  ];

  for (const filter of filters) {
    const rows = await list("tasks/list", filter, null);
    const openRows = rows.filter(open);
    console.log("apiKey", JSON.stringify(filter), "total", rows.length, "open", openRows.length);
  }

  if (token) {
    for (const filter of [{ doer_id: leadId }, { user_id: leadId }]) {
      const rows = await list("tasks/list", filter, token);
      console.log("userToken", JSON.stringify(filter), "total", rows.length, "open", rows.filter(open).length);
    }
  }

  const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mapping_ba_update.json"), "utf8"));
  const rosterIds = (await list("users/list", {}, null))
    .filter((u) => mapping.members.filter((m) => m.team === "COE").map((m) => m.email.toLowerCase()).includes(String(u.email).toLowerCase()))
    .map((u) => u.id);

  const seen = new Set();
  const teamTasks = [];
  for (const uid of rosterIds) {
    const rows = await list("tasks/list", { modified_date: { from_date: `${year}-01-01`, to_date: `${year}-12-31` }, doer_id: uid }, null);
    for (const t of rows) {
      const id = Number(t.event_id ?? t.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      teamTasks.push(t);
    }
  }
  const leadOpen = teamTasks.filter((t) => open(t) && assignees(t).includes(leadId));
  const pids = new Set(leadOpen.map((t) => Number(t.project_id)).filter(Boolean));
  console.log("\nTeam 2026 tasks:", teamTasks.length);
  console.log("Lead open tasks (assignee match):", leadOpen.length);
  console.log("Distinct projects:", pids.size);
}

main().catch(console.error);
