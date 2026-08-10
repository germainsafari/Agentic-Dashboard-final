/**
 * Diff cached dashboard active projects vs live Scoro (current dashboard logic).
 * Usage: node scripts/diff-active-projects.mjs [teamCode]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const TEAMS = {
  "1": { label: "Team 01", lead: "maciej.ochecki@admindagency.com" },
  "2": { label: "Team 02", lead: "andrzej.leraczyk@admindagency.com" },
  "4": { label: "Team 04", lead: "dominik.wycislo@admindagency.com" },
  COE: { label: "Events", lead: "hayley.smith@admindagency.com" },
};

const onlyTeam = process.argv[2];
const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID ?? "admindagency";

const LEAD_KEYS = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];
const EXCL_BUDGET = /\b(admind\s*project|growth|barter|business\s*development)\b/i;
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

async function listAll(path, filter) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const rows = await post(path, { filter, detailed_response: true, per_page: 100, page });
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
  for (const a of t.assignees ?? t.doers ?? t.related_users ?? []) {
    if (typeof a === "number") add(a);
    else if (a) add(a.user_id ?? a.userId ?? a.id);
  }
  add(t.responsible_user_id);
  add(t.user_id);
  add(t.owner_id);
  add(t.assigned_to);
  add(t.doer_id);
  return ids;
}

function taskCompleted(t) {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return true;
  if (typeof t.datetime_completed === "string" && t.datetime_completed.length >= 10) return true;
  const b = `${t.status ?? ""} ${t.status_name ?? ""}`.toLowerCase();
  return /\b(completed|done|invoiced)\b/.test(b);
}

function budgetType(p) {
  const cf = p.customFields;
  if (cf?.c_budgettype) return String(cf.c_budgettype).toLowerCase().trim();
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

function isCompletedOrInvoiced(p) {
  const s = String(p.status ?? "").toLowerCase();
  if (s === "completed" || s === "invoiced" || s === "additional6") return true;
  const sn = String(p.status_name ?? p.statusName ?? "").toLowerCase();
  return sn === "completed" || sn === "invoiced";
}

function isTerminalProject(p) {
  if (isCompletedOrInvoiced(p)) return true;
  const blob = normStatus(p);
  if (!blob.length) return false;
  return /\b(cancelled|canceled)\b/.test(blob);
}

function isExcludedBudget(p) {
  return EXCL_BUDGET.test(budgetType(p));
}

function projectId(p) {
  const id = Number(p.project_id ?? p.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function taskProjectId(t) {
  const id = Number(t.project_id ?? t.projectId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function activityIdFromEntry(e) {
  const id = Number(e.activity_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function internalNonBillableIds(rows) {
  const group = rows.find(
    (r) => r.is_group == 1 && String(r.name ?? "").trim().toLowerCase() === INTERNAL_GROUP
  );
  if (!group) return new Set();
  const ids = new Set([group.activity_id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (ids.has(r.parent_id) && !ids.has(r.activity_id)) {
        ids.add(r.activity_id);
        changed = true;
      }
    }
  }
  return ids;
}

async function loadSnapshot() {
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`SELECT payload, fetched_at FROM director_snapshots WHERE director_id = 'marta' LIMIT 1`;
  if (!rows.length) return null;
  return { entry: rows[0].payload, fetchedAt: rows[0].fetched_at };
}

async function liveActiveForLead(leadId, internalIds) {
  const seen = new Set();
  const tasks = [];
  for (const key of LEAD_KEYS) {
    const rows = await listAll("tasks/list", { [key]: leadId, is_completed: 0 });
    for (const t of rows) {
      const id = Number(t.event_id ?? t.id ?? t.task_id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      tasks.push(t);
    }
  }

  const openTasks = tasks.filter((t) => {
    if (taskCompleted(t)) return false;
    if (!assignees(t).includes(leadId)) return false;
    const aid = activityIdFromEntry(t);
    if (aid != null && internalIds.has(aid)) return false;
    return true;
  });

  const pids = [...new Set(openTasks.map(taskProjectId).filter(Boolean))];
  const projects = [];
  for (const id of pids) {
    const rows = await post("projects/list", {
      filter: { project_id: id },
      detailed_response: true,
      per_page: 1,
      page: 1,
    });
    if (rows[0]) projects.push(rows[0]);
  }

  const active = projects.filter((p) => !isTerminalProject(p) && !isExcludedBudget(p));
  return { openTasks, projects, active };
}

function fmtProject(p) {
  return `[${projectId(p)}] ${String(p.project_name ?? "").slice(0, 60)} · status=${normStatus(p) || "(empty)"} · budget=${budgetType(p) || "?"}`;
}

async function diffTeam(code, team, snapshot, users, internalIds) {
  const user = users.find((u) => String(u.email ?? "").toLowerCase() === team.lead);
  if (!user) {
    console.log(`\n=== ${team.label} — lead not found ===`);
    return;
  }

  const cached = (snapshot?.entry.teamStats ?? []).find((t) => t.team?.code === code);
  const cachedDetails = cached?.stats?.activeProjectDetails ?? [];
  const cachedIds = new Set(cachedDetails.map((d) => d.projectId));

  const live = await liveActiveForLead(user.id, internalIds);
  const liveIds = new Set(live.active.map(projectId));

  const onlyCache = cachedDetails.filter((d) => !liveIds.has(d.projectId));
  const onlyLive = live.active.filter((p) => !cachedIds.has(projectId(p)));

  console.log(`\n=== ${team.label} (${code}) ===`);
  console.log(`Snapshot fetched: ${snapshot?.fetchedAt ?? "n/a"}`);
  console.log(`Cached: ${cached?.stats?.activeProjects ?? "?"} (${cachedDetails.length} details)`);
  console.log(`Live (dashboard logic): ${live.active.length}`);

  if (onlyCache.length) {
    console.log(`\nOnly in CACHE (+${onlyCache.length}):`);
    for (const d of onlyCache) {
      console.log(`  [${d.projectId}] ${d.name} · ${d.status} · ${d.budgetType}`);
      const full = live.projects.find((p) => projectId(p) === d.projectId);
      if (full) {
        console.log(`    → project exists in Scoro: ${fmtProject(full)} terminal=${isTerminalProject(full)} exclBudget=${isExcludedBudget(full)}`);
      } else {
        console.log(`    → project NOT in lead's open-task project set anymore`);
      }
    }
  }

  if (onlyLive.length) {
    console.log(`\nOnly in LIVE Scoro (+${onlyLive.length}):`);
    for (const p of onlyLive) console.log(`  ${fmtProject(p)}`);
  }

  if (!onlyCache.length && !onlyLive.length) {
    console.log("Lists match exactly.");
  }
}

async function main() {
  const activities = await listAll("activities/list", {});
  const internalIds = internalNonBillableIds(activities);
  console.log(`Internal activity ids: ${internalIds.size}`);

  const users = await listAll("users/list", {});
  const snapshot = await loadSnapshot();

  const codes = onlyTeam ? [onlyTeam] : Object.keys(TEAMS);
  for (const code of codes) {
    if (!TEAMS[code]) {
      console.error(`Unknown team: ${code}`);
      continue;
    }
    await diffTeam(code, TEAMS[code], snapshot, users, internalIds);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
