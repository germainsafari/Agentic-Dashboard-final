/**
 * Extended audit: compare lead tasks, roster projects, and Scoro-like open-task logic.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const teamCode = process.argv[2] ?? "COE";
const leadEmail = (process.argv[3] ?? "hayley.smith@admindagency.com").toLowerCase();
const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID ?? "admindagency";

const TERMINAL_RE = /\b(completed|invoiced|cancelled|canceled|closed|declined|rejected|inactive)\b/i;
const EXCLUDED_BUDGET_RE = /\b(admind\s*project|growth|barter)\b/i;
const TASK_USER_KEYS = ["doer_id", "owner_id", "user_id", "assigned_to", "responsible_id", "responsible_user_id"];

function normStatus(p) {
  return `${p.status ?? ""} ${p.status_name ?? p.statusName ?? ""}`.toLowerCase().trim();
}
function budgetType(p) {
  const cf = p.customFields;
  if (cf?.c_budgettype) return String(cf.c_budgettype).toLowerCase().trim();
  const rows = p.custom_fields;
  if (Array.isArray(rows)) {
    for (const r of rows) if (String(r.name ?? "").toLowerCase() === "budget type" && r.value) return String(r.value).toLowerCase().trim();
  }
  return String(p.budget_type_label ?? p.budget_type ?? "").toLowerCase().trim();
}
function isTerminal(p) { const b = normStatus(p); return !b.length || TERMINAL_RE.test(b); }
function isExcludedBudget(p) { return EXCLUDED_BUDGET_RE.test(budgetType(p)); }
function projectId(p) { const id = Number(p.project_id ?? p.id); return Number.isFinite(id) && id > 0 ? id : null; }
function taskProjectId(t) { const id = Number(t.project_id ?? t.projectId); return Number.isFinite(id) && id > 0 ? id : null; }
function taskCompleted(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return true;
  if (typeof t.datetime_completed === "string" && t.datetime_completed.length >= 10) return true;
  if (t.isDone === true) return true;
  if (t.doneDateTime) return true;
  return /\b(completed|done|invoiced)\b/i.test(`${t.status ?? ""} ${t.status_name ?? t.statusName ?? ""}`);
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
  for (let page = 1; page <= 60; page++) {
    const rows = await scoroPost(path, { filter, detailed_response: detailed, per_page: 100, page });
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

function activeCount(projects) {
  return projects.filter((p) => !isTerminal(p) && !isExcludedBudget(p));
}

async function main() {
  const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mapping_ba_update.json"), "utf8"));
  const teamEmails = mapping.members.filter((m) => m.team === teamCode).map((m) => m.email.toLowerCase());
  const users = await scoroListAll("users/list", {}, false);
  const lead = users.find((u) => String(u.email ?? "").toLowerCase() === leadEmail);
  const roster = users.filter((u) => teamEmails.includes(String(u.email ?? "").toLowerCase()));

  console.log(`Roster ids: ${roster.map((u) => u.id).join(", ")}\n`);

  // Try extra task filter keys
  for (const key of TASK_USER_KEYS) {
    const tasks = await scoroListAll("tasks/list", { [key]: lead.id });
    const open = tasks.filter((t) => !taskCompleted(t));
    const pids = new Set(open.map(taskProjectId).filter(Boolean));
    console.log(`tasks/list ${key}: total=${tasks.length} open=${open.length} projects=${pids.size}`);
  }

  // Roster projects via participant filter
  const seen = new Set();
  const rosterProjects = [];
  for (const u of roster) {
    const rows = await scoroListAll("projects/list", { user_id: u.id });
    for (const p of rows) {
      const id = projectId(p);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rosterProjects.push(p);
    }
  }
  const rosterActive = activeCount(rosterProjects);
  console.log(`\nRoster participant projects: total=${rosterProjects.length} active=${rosterActive.length}`);
  for (const p of rosterActive.sort((a, b) => String(a.project_name).localeCompare(String(b.project_name)))) {
    console.log(`  [${projectId(p)}] ${p.project_name} · ${normStatus(p)} · ${budgetType(p)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
