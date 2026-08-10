/**
 * Verify Marta dashboard active-project counts vs live Scoro (same logic as sync).
 * Usage: node scripts/verify-marta-active.mjs
 */
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
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID ?? "admindagency";

const TEAMS = [
  { code: "1", label: "Team 01", lead: "maciej.ochecki@admindagency.com", expected: 39 },
  { code: "2", label: "Team 02", lead: "andrzej.leraczyk@admindagency.com", expected: 30 },
  { code: "4", label: "Team 04", lead: "dominik.wycislo@admindagency.com", expected: 36 },
  { code: "COE", label: "Events", lead: "hayley.smith@admindagency.com", expected: 15 },
];

const LEAD_KEYS = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];
const TERMINAL = /\b(completed|invoiced|cancelled|canceled)\b/i;
const EXCL = /\b(admind\s*project|growth|barter|business\s*development)\b/i;

async function post(p, b) {
  const r = await fetch(`${base}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...b }),
  });
  const j = await r.json();
  if (j.status !== "OK" && j.statusCode !== 200 && j.statusCode !== "200") {
    throw new Error(`${p}: ${JSON.stringify(j.messages ?? j)}`);
  }
  return j.data ?? [];
}

async function list(path, filter) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const rows = await post(path, { filter, detailed_response: true, per_page: 25, page });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 25) break;
  }
  return out;
}

function assignees(t) {
  const ids = [];
  const add = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  };
  for (const a of t.assignees ?? t.doers ?? []) {
    if (typeof a === "number") add(a);
    else if (a) add(a.user_id ?? a.userId ?? a.id);
  }
  add(t.responsible_user_id);
  add(t.user_id);
  add(t.doer_id);
  return ids;
}

function open(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return false;
  const b = `${t.status ?? ""} ${t.status_name ?? ""}`.toLowerCase();
  return !/\b(completed|done|invoiced)\b/.test(b);
}

function bt(p) {
  const rows = p.custom_fields || [];
  for (const r of rows) if (String(r.name ?? "").toLowerCase() === "budget type" && r.value) return String(r.value).toLowerCase();
  return "";
}

function norm(p) {
  return `${p.status ?? ""} ${p.status_name ?? ""}`.toLowerCase().trim();
}

async function countActiveForLead(leadId) {
  const seen = new Set();
  const tasks = [];
  for (const key of LEAD_KEYS) {
    const rows = await list("tasks/list", { [key]: leadId, is_completed: 0 });
    for (const t of rows) {
      const id = Number(t.event_id ?? t.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      tasks.push(t);
    }
  }
  const openTasks = tasks.filter((t) => open(t) && assignees(t).includes(leadId));
  const pids = [...new Set(openTasks.map((t) => Number(t.project_id)).filter(Boolean))];
  const projects = [];
  for (const id of pids) {
    const rows = await post("projects/list", { filter: { project_id: id }, detailed_response: true, per_page: 1, page: 1 });
    if (rows[0]) projects.push(rows[0]);
  }
  const active = projects.filter((p) => norm(p) && !TERMINAL.test(norm(p)) && !EXCL.test(bt(p)));
  return { openTasks: openTasks.length, projectIds: pids.length, active: active.length, names: active.map((p) => p.project_name) };
}

const users = await list("users/list", {});
console.log("Marta Szmyd dashboard vs Scoro (active projects)\n");
console.log("Team        | Sync | Scoro | Match | Open tasks | Raw projects");
console.log("------------|------|-------|-------|------------|-------------");

for (const team of TEAMS) {
  const user = users.find((u) => String(u.email ?? "").toLowerCase() === team.lead);
  if (!user) {
    console.log(`${team.label.padEnd(11)} | ${team.expected}    | ERR   | —     | lead not found`);
    continue;
  }
  const r = await countActiveForLead(user.id);
  const match = r.active === team.expected ? "✓" : "✗";
  console.log(
    `${team.label.padEnd(11)} | ${String(team.expected).padStart(4)} | ${String(r.active).padStart(5)} | ${match.padStart(5)} | ${String(r.openTasks).padStart(10)} | ${String(r.projectIds).padStart(11)}`
  );
  if (match === "✗") {
    console.log(`  → mismatch: sync=${team.expected} scoro=${r.active}`);
  }
}
