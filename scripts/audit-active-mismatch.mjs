/**
 * Find why verify-marta counts differ from full dashboard logic (+1 cases).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const TEAMS = [
  { label: "Team 01", lead: "maciej.ochecki@admindagency.com" },
  { label: "Team 02", lead: "andrzej.leraczyk@admindagency.com" },
  { label: "Team 04", lead: "dominik.wycislo@admindagency.com" },
  { label: "Events", lead: "hayley.smith@admindagency.com" },
];

const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID ?? "admindagency";
const LEAD_KEYS = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];
const TERMINAL_VERIFY = /\b(completed|invoiced|cancelled|canceled)\b/i;
const EXCL_VERIFY = /\b(admind\s*project|growth|barter|business\s*development)\b/i;
const EXCL_DASH = EXCL_VERIFY;
const INTERNAL_GROUP = "internal activities (non billable)";

async function post(p, body) {
  const r = await fetch(`${base}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...body }),
  });
  const j = await r.json();
  if (j.status !== "OK" && j.statusCode !== 200 && j.statusCode !== "200") {
    throw new Error(`${p}: ${JSON.stringify(j.messages ?? j)}`);
  }
  return j.data ?? [];
}

async function listAll(path, filter = {}, detailed = true) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const rows = await post(path, { filter, detailed_response: detailed, per_page: 100, page });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 100) break;
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
  add(t.assigned_to);
  return ids;
}

function openTask(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return false;
  const b = `${t.status ?? ""} ${t.status_name ?? ""}`.toLowerCase();
  return !/\b(completed|done|invoiced)\b/.test(b);
}

function budgetType(p) {
  for (const r of p.custom_fields ?? []) {
    if (String(r.name ?? "").toLowerCase() === "budget type" && r.value) {
      return String(r.value).toLowerCase().trim();
    }
  }
  return String(p.budget_type_label ?? p.budget_type ?? "").toLowerCase().trim();
}

function normStatus(p) {
  return `${p.status ?? ""} ${p.status_name ?? p.statusName ?? ""}`.toLowerCase().trim();
}

function projectId(p) {
  const id = Number(p.project_id ?? p.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isCompletedOrInvoiced(p) {
  const sn = String(p.status_name ?? p.statusName ?? "").toLowerCase();
  const s = String(p.status ?? "").toLowerCase();
  return sn === "completed" || sn === "invoiced" || s === "completed" || s === "invoiced";
}

function isTerminalDashboard(p) {
  if (isCompletedOrInvoiced(p)) return true;
  const blob = normStatus(p);
  if (!blob.length) return false;
  return /\b(cancelled|canceled)\b/.test(blob);
}

function activeVerify(projects) {
  return projects.filter((p) => normStatus(p) && !TERMINAL_VERIFY.test(normStatus(p)) && !EXCL_VERIFY.test(budgetType(p)));
}

function activeDashboard(projects) {
  return projects.filter((p) => !isTerminalDashboard(p) && !EXCL_DASH.test(budgetType(p)));
}

function internalIdsFromActivities(rows) {
  const group = rows.find(
    (r) => Number(r.is_group) === 1 && String(r.name ?? "").trim().toLowerCase() === INTERNAL_GROUP
  );
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

async function fetchLeadOpenTasks(leadId, internalIds, filterInternal) {
  const seen = new Set();
  const tasks = [];
  for (const key of LEAD_KEYS) {
    const rows = await listAll("tasks/list", { [key]: leadId, is_completed: 0 });
    for (const t of rows) {
      const id = Number(t.event_id ?? t.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      tasks.push(t);
    }
  }
  return tasks.filter((t) => {
    if (!openTask(t) || !assignees(t).includes(leadId)) return false;
    if (filterInternal) {
      const aid = Number(t.activity_id);
      if (Number.isFinite(aid) && internalIds.has(aid)) return false;
    }
    return true;
  });
}

async function fetchProjects(pids) {
  const projects = [];
  for (const id of pids) {
    const rows = await post("projects/list", { filter: { project_id: id }, detailed_response: true, per_page: 1, page: 1 });
    if (rows[0]) projects.push(rows[0]);
  }
  return projects;
}

function fmt(p) {
  return `[${projectId(p)}] ${String(p.project_name ?? "").slice(0, 55)} | status="${normStatus(p) || "(empty)"}" | budget=${budgetType(p) || "?"}`;
}

async function analyzeTeam(team, users, internalIds) {
  const user = users.find((u) => String(u.email ?? "").toLowerCase() === team.lead);
  if (!user) {
    console.log(`\n=== ${team.label}: lead not found ===`);
    return;
  }

  const tasksNoFilter = await fetchLeadOpenTasks(user.id, internalIds, false);
  const tasksFiltered = await fetchLeadOpenTasks(user.id, internalIds, true);
  const pidsNoFilter = [...new Set(tasksNoFilter.map((t) => Number(t.project_id)).filter(Boolean))];
  const pidsFiltered = [...new Set(tasksFiltered.map((t) => Number(t.project_id)).filter(Boolean))];
  const projects = await fetchProjects(pidsNoFilter);

  const verify = activeVerify(projects);
  const dashOld = activeDashboard(projects);
  const removedByInternal = pidsNoFilter.filter((id) => !pidsFiltered.includes(id));

  console.log(`\n=== ${team.label} (lead ${user.id}) ===`);
  console.log(`Open tasks: ${tasksNoFilter.length} raw → ${tasksFiltered.length} after internal-activity filter`);
  console.log(`Verify script active: ${verify.length}`);
  console.log(`Dashboard logic active (no task filter): ${dashOld.length}`);

  const verifyIds = new Set(verify.map(projectId));
  const dashIds = new Set(dashOld.map(projectId));

  const onlyDash = dashOld.filter((p) => !verifyIds.has(projectId(p)));
  const onlyVerify = verify.filter((p) => !dashIds.has(projectId(p)));

  if (onlyDash.length) {
    console.log("\nCounted by DASHBOARD but not VERIFY (+dashboard):");
    for (const p of onlyDash) {
      console.log(`  ${fmt(p)}`);
      console.log(`    isTerminalDashboard=${isTerminalDashboard(p)} | normStatus empty=${!normStatus(p)}`);
    }
  }
  if (onlyVerify.length) {
    console.log("\nCounted by VERIFY but not DASHBOARD (+verify):");
    for (const p of onlyVerify) console.log(`  ${fmt(p)}`);
  }

  if (removedByInternal.length) {
    console.log(`\nProject IDs lost purely to internal-activity task filter: ${removedByInternal.length}`);
  }

  const dashFilteredProjects = projects.filter((p) => pidsFiltered.includes(projectId(p)));
  const dashNew = activeDashboard(dashFilteredProjects);
  console.log(`Dashboard logic WITH internal task filter: ${dashNew.length}`);
  if (dashNew.length !== verify.length) {
    const vIds = new Set(verify.map(projectId));
    const nIds = new Set(dashNew.map(projectId));
    for (const p of dashNew.filter((x) => !vIds.has(projectId(x)))) console.log(`  NEW only: ${fmt(p)}`);
    for (const p of verify.filter((x) => !nIds.has(projectId(x)))) console.log(`  VERIFY only: ${fmt(p)}`);
  }
}

const activities = await listAll("activities/list", {});
const internalIds = internalIdsFromActivities(activities);
console.log(`Internal non-billable activity ids: ${internalIds.size}`);

const users = await listAll("users/list", {}, false);
console.log(`Users loaded: ${users.length}`);

for (const team of TEAMS) {
  await analyzeTeam(team, users, internalIds);
}
