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
const keys = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];

async function post(p, b) {
  const r = await fetch(`${base}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...b }),
  });
  return (await r.json()).data ?? [];
}

async function tasks(filter) {
  const out = [];
  for (let page = 1; page <= 80; page++) {
    const rows = await post("tasks/list", { filter, detailed_response: true, per_page: 25, page });
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
  add(t.assigned_to);
  return ids;
}

function open(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return false;
  const b = `${t.status ?? ""} ${t.status_name ?? ""}`.toLowerCase();
  return !/\b(completed|done|invoiced)\b/.test(b);
}

const TERMINAL = /\b(completed|invoiced|cancelled|canceled|closed|declined|rejected|inactive)\b/i;
const EXCL = /\b(admind\s*project|growth|barter)\b/i;

function bt(p) {
  const rows = p.custom_fields || [];
  for (const r of rows) if (String(r.name ?? "").toLowerCase() === "budget type" && r.value) return String(r.value).toLowerCase();
  return String(p.budget_type ?? "").toLowerCase();
}

function norm(p) {
  return `${p.status ?? ""} ${p.status_name ?? ""}`.toLowerCase().trim();
}

const seen = new Set();
const all = [];
for (const key of keys) {
  const rows = await tasks({ [key]: leadId, is_completed: 0 });
  for (const t of rows) {
    const id = Number(t.event_id ?? t.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    all.push(t);
  }
}

const verified = all.filter((t) => open(t) && assignees(t).includes(leadId));
const pids = [...new Set(verified.map((t) => Number(t.project_id)).filter(Boolean))];
console.log("raw merged", all.length, "verified open+assignee", verified.length, "projects", pids.length);

const projects = [];
for (const id of pids) {
  const rows = await post("projects/list", { filter: { project_id: id }, detailed_response: true, per_page: 1, page: 1 });
  if (rows[0]) projects.push(rows[0]);
}
const active = projects.filter((p) => norm(p) && !TERMINAL.test(norm(p)) && !EXCL.test(bt(p)));
console.log("active client projects", active.length);
for (const p of active.sort((a, b) => String(a.project_name).localeCompare(String(b.project_name)))) {
  const count = verified.filter((t) => Number(t.project_id) === Number(p.project_id)).length;
  console.log(`  [${p.project_id}] ${p.project_name} (${count} open tasks) · ${norm(p)} · ${bt(p)}`);
}
