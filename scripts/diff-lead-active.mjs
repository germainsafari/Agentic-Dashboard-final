/**
 * List active projects for a design lead — verify vs dashboard logic diff.
 * Usage: node scripts/diff-lead-active.mjs <leadId> <leadEmail>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const leadId = Number(process.argv[2]);
const label = process.argv[3] ?? `lead ${leadId}`;
const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID;
const LEAD_KEYS = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];
const TERMINAL_VERIFY = /\b(completed|invoiced|cancelled|canceled)\b/i;
const EXCL = /\b(admind\s*project|growth|barter|business\s*development)\b/i;
const INTERNAL_GROUP = "internal activities (non billable)";

async function post(p, body) {
  const r = await fetch(`${base}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...body }),
  });
  const j = await r.json();
  if (j.status !== "OK" && j.statusCode !== 200 && j.statusCode !== "200") {
    throw new Error(JSON.stringify(j.messages ?? j));
  }
  return j.data ?? [];
}

async function listTasks(filter) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
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
  const id = Number(p.project_id ?? p.id);
  return Number.isFinite(id) && id > 0 ? id : null;
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

function internalIds(rows) {
  const group = rows.find((r) => Number(r.is_group) === 1 && String(r.name ?? "").trim().toLowerCase() === INTERNAL_GROUP);
  if (!group) return new Set();
  const ids = new Set([group.activity_id]);
  let ch = true;
  while (ch) {
    ch = false;
    for (const r of rows) {
      if (ids.has(r.parent_id) && !ids.has(r.activity_id)) {
        ids.add(r.activity_id);
        ch = true;
      }
    }
  }
  return ids;
}

function fmt(p) {
  return `[${pid(p)}] ${String(p.project_name ?? "").slice(0, 60)} | status="${normStatus(p) || "(empty)"}" | budget=${budgetType(p) || "?"}`;
}

const activities = [];
for (let page = 1; page <= 10; page++) {
  const rows = await post("activities/list", { per_page: 100, page });
  if (!rows.length) break;
  activities.push(...rows);
  if (rows.length < 100) break;
}
const internal = internalIds(activities);
console.log(`Internal activity ids: ${internal.size}`);

const seen = new Set();
const tasks = [];
for (const key of LEAD_KEYS) {
  const rows = await listTasks({ [key]: leadId, is_completed: 0 });
  for (const t of rows) {
    const id = Number(t.event_id ?? t.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    tasks.push(t);
  }
}

const openTasksVerify = tasks.filter((t) => openTask(t) && assignees(t).includes(leadId));
const openTasksDash = openTasksVerify.filter((t) => {
  const aid = Number(t.activity_id);
  return !(Number.isFinite(aid) && internal.has(aid));
});

console.log(`\n=== ${label} ===`);
console.log(`Merged tasks (is_completed=0): ${tasks.length}`);
console.log(`Open + lead assignee (verify): ${openTasksVerify.length}`);
console.log(`After internal-activity task filter (dashboard): ${openTasksDash.length}`);

const pidsVerify = [...new Set(openTasksVerify.map((t) => Number(t.project_id)).filter(Boolean))];
const pidsDash = [...new Set(openTasksDash.map((t) => Number(t.project_id)).filter(Boolean))];

const projects = [];
for (const id of pidsVerify) {
  const rows = await post("projects/list", { filter: { project_id: id }, detailed_response: true, per_page: 1, page: 1 });
  if (rows[0]) projects.push(rows[0]);
}

const verifyActive = projects.filter((p) => normStatus(p) && !TERMINAL_VERIFY.test(normStatus(p)) && !EXCL.test(budgetType(p)));
const dashActive = projects.filter((p) => pidsDash.includes(pid(p)) && !isTerminalDashboard(p) && !EXCL.test(budgetType(p)));

console.log(`\nVerify active: ${verifyActive.length}`);
console.log(`Dashboard active: ${dashActive.length}`);

const vSet = new Set(verifyActive.map(pid));
const dSet = new Set(dashActive.map(pid));

const onlyDash = dashActive.filter((p) => !vSet.has(pid(p)));
const onlyVerify = verifyActive.filter((p) => !dSet.has(pid(p)));

if (onlyDash.length) {
  console.log("\n+ DASHBOARD only (explains sync > verify):");
  for (const p of onlyDash) console.log(`  ${fmt(p)}`);
}
if (onlyVerify.length) {
  console.log("\n+ VERIFY only:");
  for (const p of onlyVerify) console.log(`  ${fmt(p)}`);
}

const borderline = projects.filter((p) => {
  const n = normStatus(p);
  return (
    !n ||
    TERMINAL_VERIFY.test(n) !== isTerminalDashboard(p) ||
    (TERMINAL_VERIFY.test(n) && !isTerminalDashboard(p)) ||
    (!TERMINAL_VERIFY.test(n) && isTerminalDashboard(p))
  );
});
if (borderline.length) {
  console.log(`\nBorderline status handling (${borderline.length}):`);
  for (const p of borderline.slice(0, 10)) {
    console.log(`  ${fmt(p)} | verifyTerminal=${TERMINAL_VERIFY.test(normStatus(p))} dashTerminal=${isTerminalDashboard(p)}`);
  }
}
