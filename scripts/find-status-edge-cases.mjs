/** Find projects active in dashboard logic but excluded by verify (empty status etc.) */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const leadId = Number(process.argv[2] ?? 92);
const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID;
const LEAD_KEYS = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];
const TERMINAL_VERIFY = /\b(completed|invoiced|cancelled|canceled)\b/i;
const EXCL = /\b(admind\s*project|growth|barter|business\s*development)\b/i;

async function post(p, body) {
  const r = await fetch(`${base}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...body }),
  });
  return (await r.json()).data ?? [];
}

function assignees(t) {
  const ids = [];
  const add = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  };
  for (const a of t.assignees ?? t.doers ?? []) {
    if (typeof a === "number") add(a);
    else if (a) add(a.user_id ?? a.id);
  }
  add(t.responsible_user_id);
  add(t.user_id);
  add(t.doer_id);
  return ids;
}

function openTask(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return false;
  const b = `${t.status ?? ""} ${t.status_name ?? ""}`.toLowerCase();
  return !/\b(completed|done|invoiced)\b/.test(b);
}

function budgetType(p) {
  for (const r of p.custom_fields ?? []) {
    if (String(r.name ?? "").toLowerCase() === "budget type" && r.value) return String(r.value).toLowerCase().trim();
  }
  return String(p.budget_type_label ?? p.budget_type ?? "").toLowerCase().trim();
}

function normStatus(p) {
  return `${p.status ?? ""} ${p.status_name ?? p.statusName ?? ""}`.toLowerCase().trim();
}

function pid(p) {
  return Number(p.project_id ?? p.id);
}

function isCompletedOrInvoiced(p) {
  const s = String(p.status ?? "").toLowerCase();
  if (s === "completed" || s === "invoiced" || s === "additional6") return true;
  const sn = String(p.status_name ?? p.statusName ?? "").toLowerCase();
  return sn === "completed" || sn === "invoiced";
}

function isTerminalDashboard(p) {
  if (isCompletedOrInvoiced(p)) return true;
  const blob = normStatus(p);
  if (!blob.length) return false;
  return /\b(cancelled|canceled)\b/.test(blob);
}

const seen = new Set();
const tasks = [];
for (const key of LEAD_KEYS) {
  for (let page = 1; page <= 40; page++) {
    const rows = await post("tasks/list", {
      filter: { [key]: leadId, is_completed: 0 },
      detailed_response: true,
      per_page: 25,
      page,
    });
    if (!rows.length) break;
    for (const t of rows) {
      const id = Number(t.event_id ?? t.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        tasks.push(t);
      }
    }
    if (rows.length < 25) break;
  }
}

const openTasks = tasks.filter((t) => openTask(t) && assignees(t).includes(leadId));
const pids = [...new Set(openTasks.map((t) => Number(t.project_id)).filter(Boolean))];
const projects = [];
for (const id of pids) {
  const rows = await post("projects/list", { filter: { project_id: id }, detailed_response: true, per_page: 1, page: 1 });
  if (rows[0]) projects.push(rows[0]);
}

const verifyActive = projects.filter((p) => normStatus(p) && !TERMINAL_VERIFY.test(normStatus(p)) && !EXCL.test(budgetType(p)));
const dashActive = projects.filter((p) => !isTerminalDashboard(p) && !EXCL.test(budgetType(p)));

console.log(`verify=${verifyActive.length} dashboard(no task filter)=${dashActive.length}`);

const vIds = new Set(verifyActive.map(pid));
for (const p of dashActive) {
  if (!vIds.has(pid(p))) {
    console.log("DASH ONLY:", pid(p), p.project_name, `status="${normStatus(p) || "(empty)"}"`, budgetType(p));
  }
}

for (const p of projects) {
  const n = normStatus(p);
  const vOk = n && !TERMINAL_VERIFY.test(n) && !EXCL.test(budgetType(p));
  const dOk = !isTerminalDashboard(p) && !EXCL.test(budgetType(p));
  if (vOk !== dOk) {
    console.log("LOGIC SPLIT:", pid(p), p.project_name, `norm="${n}"`, `verify=${vOk}`, `dash=${dOk}`, `status_code=${p.status}`, `status_name=${p.status_name}`);
  }
}
