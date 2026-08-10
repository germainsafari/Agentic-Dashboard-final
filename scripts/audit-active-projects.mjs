/**
 * Compare dashboard active-project logic vs Scoro for a team design lead.
 * Usage: node scripts/audit-active-projects.mjs [teamCode] [leadEmail]
 * Default: COE hayley.smith@admindagency.com
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const teamCode = process.argv[2] ?? "COE";
const leadEmail = (process.argv[3] ?? "hayley.smith@admindagency.com").toLowerCase();

const base = (process.env.COMPANY_BASE_URL ?? "").replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID ?? "admindagency";

if (!base || !apiKey) {
  console.error("Missing COMPANY_BASE_URL or SCORO_API_KEY");
  process.exit(1);
}

const TERMINAL_RE = /\b(completed|invoiced|cancelled|canceled|closed|declined|rejected|inactive)\b/i;
const EXCLUDED_BUDGET_RE = /\b(admind\s*project|growth|barter)\b/i;
const TASK_USER_KEYS = ["doer_id", "owner_id", "user_id", "assigned_to"];

function normStatus(p) {
  const a = `${p.status ?? ""}`.toLowerCase();
  const b = `${p.status_name ?? p.statusName ?? ""}`.toLowerCase();
  return `${a} ${b}`.trim();
}

function budgetType(p) {
  const cf = p.customFields;
  if (cf && typeof cf.c_budgettype === "string" && cf.c_budgettype) return cf.c_budgettype.toLowerCase().trim();
  const rows = p.custom_fields;
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (String(r.name ?? "").toLowerCase() === "budget type" && r.value) return String(r.value).toLowerCase().trim();
    }
  }
  return String(p.budget_type_label ?? p.budget_type ?? "").toLowerCase().trim();
}

function isTerminal(p) {
  const blob = normStatus(p);
  if (!blob.length) return true;
  return TERMINAL_RE.test(blob);
}

function isExcludedBudget(p) {
  return EXCLUDED_BUDGET_RE.test(budgetType(p));
}

function projectId(p) {
  const id = Number(p.project_id ?? p.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function taskProjectId(t) {
  const id = Number(t.project_id ?? t.projectId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function taskCompleted(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return true;
  if (typeof t.datetime_completed === "string" && t.datetime_completed.length >= 10) return true;
  const blob = `${t.status ?? ""} ${t.status_name ?? ""}`.toLowerCase();
  return /\b(completed|done|invoiced)\b/.test(blob);
}

async function scoroPost(path, body) {
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...body }),
  });
  const json = await res.json();
  if (json.status !== "OK" && json.statusCode !== 200 && json.statusCode !== "200") {
    throw new Error(`${path}: ${JSON.stringify(json.messages ?? json)}`);
  }
  return json.data ?? [];
}

async function scoroListAll(path, filter, detailed = true) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const rows = await scoroPost(path, {
      filter,
      detailed_response: detailed,
      per_page: 100,
      page,
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

async function main() {
  const users = await scoroListAll("users/list", {}, false);
  const lead = users.find((u) => String(u.email ?? "").toLowerCase() === leadEmail);
  if (!lead) {
    console.error(`Lead not found: ${leadEmail}`);
    process.exit(1);
  }
  console.log(`Team ${teamCode} · lead ${lead.fullname ?? leadEmail} (user_id ${lead.id})\n`);

  const seenTasks = new Set();
  const allTasks = [];
  for (const key of TASK_USER_KEYS) {
    const tasks = await scoroListAll("tasks/list", { [key]: lead.id });
    for (const t of tasks) {
      const id = Number(t.event_id ?? t.id ?? t.task_id);
      if (Number.isFinite(id) && id > 0) {
        if (seenTasks.has(id)) continue;
        seenTasks.add(id);
      }
      allTasks.push(t);
    }
  }

  const openTasks = allTasks.filter((t) => !taskCompleted(t));
  const projectIdsAll = new Set(allTasks.map(taskProjectId).filter(Boolean));
  const projectIdsOpen = new Set(openTasks.map(taskProjectId).filter(Boolean));

  console.log(`Tasks assigned to lead (all time, merged filters): ${allTasks.length}`);
  console.log(`Open / non-completed tasks: ${openTasks.length}`);
  console.log(`Distinct project IDs (all tasks): ${projectIdsAll.size}`);
  console.log(`Distinct project IDs (open tasks only): ${projectIdsOpen.size}\n`);

  const projects = [];
  for (const id of projectIdsAll) {
    const rows = await scoroPost("projects/list", {
      filter: { project_id: id },
      detailed_response: true,
      per_page: 1,
      page: 1,
    });
    if (rows[0]) projects.push(rows[0]);
  }

  const activeCurrent = projects.filter((p) => !isTerminal(p) && !isExcludedBudget(p));
  const activeOpenOnly = [];
  for (const id of projectIdsOpen) {
    const p = projects.find((x) => projectId(x) === id);
    if (p && !isTerminal(p) && !isExcludedBudget(p)) activeOpenOnly.push(p);
  }

  const excludedTerminal = projects.filter((p) => isTerminal(p));
  const excludedBudget = projects.filter((p) => !isTerminal(p) && isExcludedBudget(p));

  console.log(`=== Dashboard logic (all lead tasks → non-terminal projects, excl budget) ===`);
  console.log(`Count: ${activeCurrent.length}\n`);
  for (const p of activeCurrent.sort((a, b) => String(a.project_name).localeCompare(String(b.project_name)))) {
    console.log(`  [${projectId(p)}] ${p.project_name} · status=${normStatus(p) || "?"} · budget=${budgetType(p) || "?"}`);
  }

  console.log(`\n=== Alternative: open tasks only → distinct active projects ===`);
  console.log(`Count: ${activeOpenOnly.length}\n`);
  for (const p of activeOpenOnly.sort((a, b) => String(a.project_name).localeCompare(String(b.project_name)))) {
    console.log(`  [${projectId(p)}] ${p.project_name} · status=${normStatus(p) || "?"} · budget=${budgetType(p) || "?"}`);
  }

  console.log(`\n=== Excluded (terminal status): ${excludedTerminal.length} ===`);
  for (const p of excludedTerminal.slice(0, 15)) {
    console.log(`  [${projectId(p)}] ${p.project_name} · status=${normStatus(p)}`);
  }
  if (excludedTerminal.length > 15) console.log(`  ... and ${excludedTerminal.length - 15} more`);

  console.log(`\n=== Excluded (budget type): ${excludedBudget.length} ===`);
  for (const p of excludedBudget) {
    console.log(`  [${projectId(p)}] ${p.project_name} · budget=${budgetType(p)} · status=${normStatus(p)}`);
  }

  const statusNames = new Set(projects.map((p) => normStatus(p)).filter(Boolean));
  console.log(`\n=== Unique project status strings seen ===`);
  for (const s of [...statusNames].sort()) console.log(`  "${s}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
