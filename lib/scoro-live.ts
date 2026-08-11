import "server-only";

import { KPI_META, QUARTERS, PERIODS, type Quarter } from "./brand";
import type { ResolvedTeam, WeekAvailability } from "./directors";
import { DIRECTOR_SEEDS, type DirectorSeed } from "./directors";
import { MAPPING, teamsForDirector } from "./mapping";
import { scoroListAllPages, scoroListAllPagesUser, scoroPostUser, resolveScoroUserToken } from "./scoro-api";
import type { MockEscalation } from "./mock";
import type { ActiveProjectDetail, EscalationRule, KpiDebug, KpiQuarterDebug, TeamStats } from "./mock";
import { readMeta, writeMeta } from "./snapshot-cache";
import {
  activityIdFromEntry,
  isInternalNonBillableActivityId,
  loadInternalNonBillableActivityIds,
  loadScoroActivityRows,
  clearScoroActivityCaches,
  type ScoroActivityRow,
} from "./scoro-activities";

type ScoroUser = { id: number; email: string };
type ScoroProject = Record<string, unknown>;
type ScoroTimeEntry = Record<string, unknown>;
type ScoroActivity = {
  activity_id: number;
  name: string;
  parent_id: number;
  parent_name: string;
  is_group: number;
};

export function kpiYear(): number {
  const y = Number(process.env.KPI_YEAR);
  if (Number.isFinite(y) && y >= 2000 && y <= 2100) return y;
  return new Date().getFullYear();
}

export function quarterRange(year: number, q: Quarter): { from: string; to: string } {
  const m: Record<Quarter, [number, number]> = {
    Q1: [1, 3],
    Q2: [4, 6],
    Q3: [7, 9],
    Q4: [10, 12],
  };
  const [a, b] = m[q];
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (y: number, month: number) =>
    new Date(Date.UTC(y, month, 0)).getUTCDate();
  return {
    from: `${year}-${pad(a)}-01`,
    to: `${year}-${pad(b)}-${pad(lastDay(year, b))}`,
  };
}

const CLOSED_QUARTER_BUFFER_DAYS = 30;

/** A quarter is "closed" once we're safely past its last day — its logged
 * time/absences are extremely unlikely to change, so a fresh sync can reuse
 * the last computed numerator/denominator instead of re-fetching Scoro data
 * for it. Only the still-open quarter (plus any that closed within the last
 * `CLOSED_QUARTER_BUFFER_DAYS`) gets fetched fresh each sync. */
export function isQuarterClosed(year: number, q: Quarter): boolean {
  const { to } = quarterRange(year, q);
  const cutoff = new Date(`${to}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + CLOSED_QUARTER_BUFFER_DAYS);
  return cutoff.getTime() < Date.now();
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function parseDurationToSeconds(hms: unknown): number {
  if (typeof hms !== "string" || !/^\d{1,3}:\d{2}:\d{2}$/.test(hms)) return 0;
  const [h, m, s] = hms.split(":").map(Number);
  return (h * 3600 + m * 60 + s) | 0;
}

function quarterFromIsoDate(iso: string | undefined, year: number): Quarter | null {
  if (!iso || iso.length < 7) return null;
  const y = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (y !== year || month < 1 || month > 12) return null;
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

/**
 * UTC YYYY-MM-DD through which we count each member's available hours for utilization.
 * Past KPI years: end of that year (full quarters). Current year: today. Future year: Jan 1 (edge case).
 */
export function utilizationAsOfIso(year: number): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (year < y) return `${year}-12-31`;
  if (year > y) return `${year}-01-01`;
  return `${y}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}


export async function loadAllScoroUsers(): Promise<ScoroUser[]> {
  type Row = { id?: number; email?: string };
  const rows = await scoroListAllPages<Row>("users/list", {});
  return rows
    .filter((r) => typeof r.id === "number" && typeof r.email === "string")
    .map((r) => ({ id: r.id as number, email: (r.email as string).toLowerCase() }));
}

let activityCache: Map<number, ScoroActivity> | null = null;

function activityMapFromRows(rows: ScoroActivityRow[]): Map<number, ScoroActivity> {
  const map = new Map<number, ScoroActivity>();
  for (const r of rows) {
    map.set(r.activity_id, r);
  }
  return map;
}

async function loadActivityLookup(): Promise<Map<number, ScoroActivity>> {
  if (activityCache) return activityCache;
  activityCache = activityMapFromRows(await loadScoroActivityRows());
  return activityCache;
}

export function userIdsForTeam(
  team: ResolvedTeam,
  users: ScoroUser[]
): number[] {
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const ids = new Set<number>();
  for (const m of team.members) {
    const id = byEmail.get(m.email.toLowerCase());
    if (id != null) ids.add(id);
  }
  return [...ids];
}

async function fetchTimeEntriesForUser(
  userId: number,
  from: string,
  to: string
): Promise<ScoroTimeEntry[]> {
  return scoroListAllPages<ScoroTimeEntry>("timeEntries/list", {
    filter: {
      user_id: userId,
      time_entry_date: { from_date: from, to_date: to },
    },
    maxPages: 80,
  });
}

const UTILIZATION_BUDGET_TYPES = new Set(["ce", "op", "bm", "ret"]);
const ADMIND_PROJECTS_BT_RE = /admind\s*project/i;
const SCRUM_ACTIVITY_RE = /\bscrum\b/i;

function isExcludedActivity(
  e: ScoroTimeEntry,
  internalIds: Set<number>,
  activities: Map<number, ScoroActivity>
): boolean {
  const activityId = activityIdFromEntry(e);
  const activity = activityId != null ? activities.get(activityId) : undefined;
  if (activity?.parent_id === 451) return false;
  return isInternalNonBillableActivityId(activityId, internalIds);
}

function isScrumActivity(e: ScoroTimeEntry, activities: Map<number, ScoroActivity>): boolean {
  const activityId = Number(e.activity_id);
  const activity = Number.isFinite(activityId) ? activities.get(activityId) : undefined;
  const blob = [activity?.name, activity?.parent_name, e.activity_type, e.activity]
    .filter(Boolean)
    .join(" ");
  return SCRUM_ACTIVITY_RE.test(blob);
}

/**
 * Every Scoro time entry is either calendar-sourced (`event_type: "cal"`, `event_id`
 * keyed into `calendar/list`) or task-sourced (`event_type: "task"`, `event_id` keyed
 * into `tasks/list`). Neither carries a `project_id` or `budget_type` field directly —
 * those must be resolved via the linked calendar event / task, then the project's own
 * `c_budgettype` custom field (see budgetTypeLabel/budgetTypeCode below).
 */
type EntryProjectResolver = {
  calendarProjectById: Map<number, number>;
  taskProjectById: Map<number, number>;
  budgetByProjectId: Map<number, { budgetTypeCode: string; budgetTypeLabel: string; isClient: boolean }>;
  /** Task's own `c_budgettype` — can be blank even when the linked project has a default set. */
  taskBudgetCodeById: Map<number, string>;
};

/** Normalizes a raw c_budgettype value (task or project) the same way for both. */
function normalizeBudgetCode(raw: string): string {
  const v = raw.toLowerCase().trim();
  if (v.includes("new business")) return "new business";
  const m = v.match(/\b(ce|op|bm|ret)\b/i);
  return m ? m[1].toLowerCase() : v;
}

const EVENT_ID_BATCH_SIZE = 100;

/**
 * Fetches calendar/list or tasks/list rows for exactly the referenced event_ids
 * (both endpoints accept a batched `event_id` array filter) instead of crawling
 * a full year of data per user — far fewer requests, and no pagination-cap
 * truncation for high-volume users.
 */
async function fetchByEventIds<T extends Record<string, unknown>>(
  path: "calendar/list" | "tasks/list",
  eventIds: number[],
  detailed = false
): Promise<T[]> {
  if (eventIds.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < eventIds.length; i += EVENT_ID_BATCH_SIZE) {
    const chunk = eventIds.slice(i, i + EVENT_ID_BATCH_SIZE);
    const rows = await scoroListAllPages<T>(path, {
      filter: { event_id: chunk },
      detailed,
      maxPages: detailed ? 20 : 5,
    });
    out.push(...rows);
  }
  return out;
}

async function buildEntryProjectResolver(
  calEventIds: number[],
  taskEventIds: number[],
  knownProjects: ScoroProject[] = []
): Promise<EntryProjectResolver> {
  const [calendarRows, taskRows] = await Promise.all([
    fetchByEventIds<Record<string, unknown>>("calendar/list", calEventIds),
    // detailed_response is required for tasks/list to include custom_fields (c_budgettype).
    fetchByEventIds<ScoroTask>("tasks/list", taskEventIds, true),
  ]);

  const calendarProjectById = new Map<number, number>();
  for (const r of calendarRows) {
    const eventId = Number(r.event_id);
    const projectId = Number(r.project_id);
    if (Number.isFinite(eventId) && eventId > 0 && Number.isFinite(projectId) && projectId > 0) {
      calendarProjectById.set(eventId, projectId);
    }
  }

  const taskProjectById = new Map<number, number>();
  const taskBudgetCodeById = new Map<number, string>();
  for (const t of taskRows) {
    const eventId = stableTaskEventId(t);
    if (eventId == null) continue;
    const projectId = taskProjectId(t);
    if (projectId != null) taskProjectById.set(eventId, projectId);
    const rawBudget = getTaskBudgetType(t);
    if (rawBudget) taskBudgetCodeById.set(eventId, normalizeBudgetCode(rawBudget));
  }

  const referencedProjectIds = new Set<number>([
    ...calendarProjectById.values(),
    ...taskProjectById.values(),
  ]);
  const known = new Map<number, ScoroProject>();
  for (const p of knownProjects) {
    const pid = projectNumericId(p);
    if (Number.isFinite(pid) && pid > 0) known.set(pid, p);
  }
  const projects = await fetchProjectsByIds([...referencedProjectIds], known);

  const budgetByProjectId = new Map<
    number,
    { budgetTypeCode: string; budgetTypeLabel: string; isClient: boolean }
  >();
  for (const p of projects) {
    const pid = projectNumericId(p);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    budgetByProjectId.set(pid, {
      budgetTypeCode: budgetTypeCode(p),
      budgetTypeLabel: budgetTypeLabel(p),
      isClient: isClientProject(p),
    });
  }

  return { calendarProjectById, taskProjectById, budgetByProjectId, taskBudgetCodeById };
}

/** Collects the distinct calendar/task event_ids referenced across a set of time entries. */
function collectReferencedEventIds(
  entries: ScoroTimeEntry[],
  calEventIds: Set<number>,
  taskEventIds: Set<number>
): void {
  for (const e of entries) {
    const eventId = Number(e.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) continue;
    if (e.event_type === "cal") calEventIds.add(eventId);
    else if (e.event_type === "task") taskEventIds.add(eventId);
  }
}

function resolveEntryProjectBudget(
  e: ScoroTimeEntry,
  resolver: EntryProjectResolver
): { budgetTypeCode: string; budgetTypeLabel: string; isClient: boolean } | null {
  const eventId = Number(e.event_id);
  if (!Number.isFinite(eventId) || eventId <= 0) return null;

  const eventType = String(e.event_type ?? "");
  const projectId =
    eventType === "cal"
      ? resolver.calendarProjectById.get(eventId)
      : eventType === "task"
        ? resolver.taskProjectById.get(eventId)
        : undefined;

  return projectId != null ? (resolver.budgetByProjectId.get(projectId) ?? null) : null;
}

/**
 * Effective c_budgettype for a task-linked entry: the task's own value when set,
 * falling back to its project's value when the task itself was never tagged.
 * Checked in this order every time — never a blanket "always task" / "always
 * project" choice — since either level can independently hold the real answer.
 */
function effectiveBudget(
  e: ScoroTimeEntry,
  resolver: EntryProjectResolver,
  projectBudget: { budgetTypeCode: string; budgetTypeLabel: string }
): { budgetTypeCode: string; budgetTypeLabel: string } {
  if (String(e.event_type ?? "") === "task") {
    const eventId = Number(e.event_id);
    const taskCode = resolver.taskBudgetCodeById.get(eventId);
    if (taskCode) return { budgetTypeCode: taskCode, budgetTypeLabel: taskCode };
  }
  return projectBudget;
}

/**
 * Classifies a time entry using the real `c_budgettype` custom field — task-level
 * first, falling back to the linked project's value when the task itself is
 * blank — resolved via the entry's linked calendar event or task
 * (see EntryProjectResolver), not fragile title-string matching.
 */
function classifyUtilizationEntry(
  e: ScoroTimeEntry,
  resolver: EntryProjectResolver,
  activities: Map<number, ScoroActivity>,
  internalIds: Set<number>
): { counted: boolean; reason: string } {
  if (isExcludedActivity(e, internalIds, activities)) {
    return { counted: false, reason: "excludedInternalActivity" };
  }

  const projectBudget = resolveEntryProjectBudget(e, resolver);
  if (!projectBudget) return { counted: false, reason: "unresolvedProject" };

  const effective = effectiveBudget(e, resolver, projectBudget);

  // Admind-Project budget type (e.g. "Admind Scrum") counts only for Scrum-tagged
  // activities — checked before the isClient gate so Scrum time isn't excluded
  // just because the project itself is administratively internal.
  if (
    ADMIND_PROJECTS_BT_RE.test(effective.budgetTypeLabel) ||
    ADMIND_PROJECTS_BT_RE.test(effective.budgetTypeCode)
  ) {
    return isScrumActivity(e, activities)
      ? { counted: true, reason: "admindProject_scrum" }
      : { counted: false, reason: "admindProject_notScrum" };
  }
  // isClient is inherently a project attribute — a task has no isClient of its own.
  if (!projectBudget.isClient) {
    return { counted: false, reason: "internalProject" };
  }
  return UTILIZATION_BUDGET_TYPES.has(effective.budgetTypeCode)
    ? { counted: true, reason: "qualifyingBudgetType" }
    : { counted: false, reason: "nonQualifyingBudgetType" };
}

export type UtilizationEntryRow = {
  timeEntryId: number | null;
  eventId: number | null;
  eventType: string;
  title: string;
  quarter: Quarter | null;
  durationHours: number;
  resolvedProjectId: number | null;
  projectBudgetTypeCode: string | null;
  taskBudgetTypeCode: string | null;
  effectiveBudgetTypeCode: string | null;
  counted: boolean;
  reason: string;
};

/**
 * Row-level diagnostic — every classified time entry for a team/year, for exact
 * reconciliation against a manual Scoro export (join on timeEntryId).
 */
export async function debugUtilizationEntries(
  team: ResolvedTeam,
  userIds: number[],
  year: number,
  projectsForUtilization: ScoroProject[] = []
): Promise<UtilizationEntryRow[]> {
  const yr = yearRange(year);
  const activities = await loadActivityLookup();
  const internalIds = await loadInternalNonBillableActivityIds();

  const entriesByUser: ScoroTimeEntry[][] = [];
  const calEventIds = new Set<number>();
  const taskEventIds = new Set<number>();
  for (const uid of userIds) {
    const entries = await fetchTimeEntriesForUser(uid, yr.from, yr.to);
    entriesByUser.push(entries);
    collectReferencedEventIds(entries, calEventIds, taskEventIds);
  }

  const resolver = await buildEntryProjectResolver(
    [...calEventIds],
    [...taskEventIds],
    projectsForUtilization
  );

  const rows: UtilizationEntryRow[] = [];
  for (const entries of entriesByUser) {
    for (const e of entries) {
      const dateStr =
        (typeof e.time_entry_date === "string" && e.time_entry_date) ||
        (typeof e.start_datetime === "string" && String(e.start_datetime).slice(0, 10)) ||
        "";
      const q = quarterFromIsoDate(dateStr, year);
      const dur = parseDurationToSeconds(e.duration);
      const result = classifyUtilizationEntry(e, resolver, activities, internalIds);
      const projectBudget = resolveEntryProjectBudget(e, resolver);
      const eventId = Number(e.event_id);
      const taskCode =
        e.event_type === "task" ? (resolver.taskBudgetCodeById.get(eventId) ?? null) : null;

      rows.push({
        timeEntryId: Number(e.time_entry_id) || null,
        eventId: Number.isFinite(eventId) && eventId > 0 ? eventId : null,
        eventType: String(e.event_type ?? ""),
        title: String(e.title ?? ""),
        quarter: q,
        durationHours: +(dur / 3600).toFixed(4),
        resolvedProjectId:
          e.event_type === "cal"
            ? (resolver.calendarProjectById.get(eventId) ?? null)
            : e.event_type === "task"
              ? (resolver.taskProjectById.get(eventId) ?? null)
              : null,
        projectBudgetTypeCode: projectBudget?.budgetTypeCode ?? null,
        taskBudgetTypeCode: taskCode,
        effectiveBudgetTypeCode: taskCode ?? projectBudget?.budgetTypeCode ?? null,
        counted: result.counted,
        reason: result.reason,
      });
    }
  }
  return rows;
}

type QuarterAgg = Record<
  Quarter,
  {
    durationSec: number;
    billableSec: number;
    utilizationSec: number;
    /** Scheduled seconds from the real per-weekday calendar (or a flat-week fallback). */
    availSec: number;
    /** Scheduled seconds lost to booked time off. */
    absenceSec: number;
    /** availSec − absenceSec, floored at 0 — the billable KPI's denominator. */
    targetSec: number;
  }
>;

function emptyQuarterAgg(): QuarterAgg {
  const o = {} as QuarterAgg;
  for (const q of QUARTERS) {
    o[q] = {
      durationSec: 0,
      billableSec: 0,
      utilizationSec: 0,
      availSec: 0,
      absenceSec: 0,
      targetSec: 0,
    };
  }
  return o;
}

const WEEKDAY_KEYS: (keyof WeekAvailability)[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Seconds this member was actually scheduled to work on a given date. Uses
 * Scoro's live per-weekday availability when present (correctly returns 0 for
 * e.g. a part-timer's non-work weekday); falls back to a flat weekly-target ÷
 * 5 on weekdays only (never weekends) when no live availability record exists
 * — the static-JSON roster path has no per-weekday data to do better with.
 */
function scheduledSecondsForDay(
  m: { weeklyTarget: number; availability?: WeekAvailability },
  isoDate: string
): number {
  const key = WEEKDAY_KEYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
  if (m.availability) return m.availability[key] ?? 0;
  if (key === "saturday" || key === "sunday") return 0;
  return (Math.max(0, m.weeklyTarget) * 3600) / 5;
}

export type AbsenceDay = { userId: number; date: string; type: string; value: number };

let _orgTimeOffs: AbsenceDay[] | null = null;
let _orgTimeOffsYear: number | null = null;

/**
 * All booked time off org-wide for the KPI year, via Scoro v2's `timeOffs/list`
 * (confirmed live: https://api.scoro.com/api/v2#timeOffsApiV2Docs — the
 * correct path is `timeOffs/list`, not `absences/list` or similar). Fetched
 * once per sync run (no user_id filter — confirmed live that the endpoint
 * returns every user's time off for the date range in one paginated call)
 * and cached in memory; per-team lookups filter this in place instead of
 * each making their own per-member API calls, the same way
 * `loadPitchCandidateTasks` shares one org-wide fetch across all teams.
 * `extra_availability` is excluded: it adds capacity rather than subtracting
 * it, which is out of scope for the billable-target calculation.
 */
async function loadOrgTimeOffs(year: number): Promise<AbsenceDay[]> {
  if (_orgTimeOffs && _orgTimeOffsYear === year) return _orgTimeOffs;

  const { from, to } = yearRange(year);
  const rows = await scoroListAllPages<Record<string, unknown>>("timeOffs/list", {
    filter: { date: { from_date: from, to_date: to } },
    maxPages: 80,
  });

  const out: AbsenceDay[] = [];
  for (const r of rows) {
    const type = String(r.type ?? "");
    if (type === "extra_availability") continue;

    const usersDates = Array.isArray(r.usersDates) ? r.usersDates : [];
    for (const ud of usersDates as Record<string, unknown>[]) {
      const userId = Number(ud.user_id);
      if (!Number.isFinite(userId)) continue;
      const dates = Array.isArray(ud.dates) ? ud.dates : [];
      for (const d of dates as Record<string, unknown>[]) {
        const date = String(d.date ?? "");
        if (!date) continue;
        out.push({ userId, date, type, value: Number(d.value ?? 0) });
      }
    }
  }

  _orgTimeOffs = out;
  _orgTimeOffsYear = year;
  console.log(`[timeoff] Loaded ${out.length} org-wide absence-days for ${year}`);
  return out;
}

async function fetchTimeOffForUserIds(userIds: number[], year: number): Promise<AbsenceDay[]> {
  if (userIds.length === 0) return [];
  const idSet = new Set(userIds);
  const all = await loadOrgTimeOffs(year);
  return all.filter((a) => idSet.has(a.userId));
}

export type PreviousUtilBillableDebug = {
  utilization: Record<string, KpiQuarterDebug>;
  billable: Record<string, KpiQuarterDebug>;
};

export async function aggregateTimeForTeam(
  team: ResolvedTeam,
  userIds: number[],
  year: number,
  users: ScoroUser[],
  projectsForUtilization: ScoroProject[] = [],
  previousDebug?: PreviousUtilBillableDebug
): Promise<QuarterAgg> {
  const agg = emptyQuarterAgg();
  const yr = yearRange(year);
  const asOfIso = utilizationAsOfIso(year);

  const activities = await loadActivityLookup();
  const internalIds = await loadInternalNonBillableActivityIds();

  // Closed quarters (safely in the past — see isQuarterClosed) reuse last
  // sync's numerator/denominator instead of being re-fetched/recomputed;
  // only the still-open quarter(s) do live Scoro work below. This is what
  // keeps a routine re-sync from re-deriving months of unchanging history
  // every single run.
  const closed = new Set<Quarter>();
  for (const q of QUARTERS) {
    if (!isQuarterClosed(year, q)) continue;
    const prevUtil = previousDebug?.utilization[q];
    const prevBill = previousDebug?.billable[q];
    if (!prevUtil || !prevBill || prevUtil.denominator <= 0) {
      // No usable cached value yet (first sync ever, or team roster is new)
      // — fall back to computing this quarter live just this once.
      continue;
    }
    agg[q].utilizationSec = prevUtil.numerator;
    agg[q].billableSec = prevBill.numerator;
    agg[q].targetSec = prevUtil.denominator;
    agg[q].availSec = prevUtil.denominator;
    closed.add(q);
  }
  // Built in QUARTERS' natural chronological order regardless of which
  // quarters ended up reclassified above — open[0] must be the earliest
  // open quarter for the fetch-window narrowing below to be correct.
  const open = QUARTERS.filter((q) => !closed.has(q));

  // Day-by-day (not weeks × flat weekly target) so a part-timer's non-work
  // weekdays correctly contribute 0, matching their real Scoro schedule.
  // Only for open quarters — closed quarters already have their targetSec.
  for (const m of team.members) {
    for (const q of open) {
      const { from, to } = quarterRange(year, q);
      if (asOfIso < from) continue;
      const end = asOfIso < to ? asOfIso : to;
      for (
        let d = new Date(`${from}T00:00:00Z`);
        d <= new Date(`${end}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        agg[q].availSec += scheduledSecondsForDay(m, d.toISOString().slice(0, 10));
      }
    }
  }

  // Absences: subtract the member's scheduled hours for each booked day,
  // capped at that day's schedule (a full-day absence on a non-work day, or a
  // partial value exceeding the day's hours, can't subtract more than the
  // person was ever scheduled to work). Only applied to open quarters.
  const emailToId = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const idToMember = new Map<number, ResolvedTeam["members"][number]>();
  for (const m of team.members) {
    const id = emailToId.get(m.email.toLowerCase());
    if (id != null) idToMember.set(id, m);
  }
  // A single day can appear in more than one time-off record (e.g. a 5-day
  // vacation block plus a separately-logged national holiday inside it) —
  // dedupe by user+date first so overlapping records don't double-subtract.
  const absencesByUserDate = new Map<string, AbsenceDay>();
  for (const a of await fetchTimeOffForUserIds(userIds, year)) {
    const key = `${a.userId}|${a.date}`;
    const existing = absencesByUserDate.get(key);
    if (!existing || (existing.value !== -1 && (a.value === -1 || a.value > existing.value))) {
      absencesByUserDate.set(key, a);
    }
  }
  for (const a of absencesByUserDate.values()) {
    const member = idToMember.get(a.userId);
    if (!member) continue;
    const q = quarterFromIsoDate(a.date, year);
    if (!q || closed.has(q)) continue;
    const scheduled = scheduledSecondsForDay(member, a.date);
    const claimed = a.value === -1 ? scheduled : Math.max(0, a.value);
    agg[q].absenceSec += Math.min(claimed, scheduled);
  }
  for (const q of open) {
    agg[q].targetSec = Math.max(0, agg[q].availSec - agg[q].absenceSec);
  }

  // Fetch each user's entries once, keep them in memory for this single team
  // (at most a handful of people), and collect exactly which calendar/task
  // event_ids need resolving — no full-year bulk crawl, no double-fetch.
  // Narrowed to the earliest open quarter's start (not the full year) since
  // closed quarters' entries are already accounted for above.
  const fetchFrom = open.length > 0 ? quarterRange(year, open[0]).from : yr.to;
  const entriesByUser: ScoroTimeEntry[][] = [];
  const calEventIds = new Set<number>();
  const taskEventIds = new Set<number>();
  for (const uid of userIds) {
    const entries = await fetchTimeEntriesForUser(uid, fetchFrom, yr.to);
    entriesByUser.push(entries);
    collectReferencedEventIds(entries, calEventIds, taskEventIds);
  }

  const resolver = await buildEntryProjectResolver(
    [...calEventIds],
    [...taskEventIds],
    projectsForUtilization
  );

  for (const entries of entriesByUser) {
    for (const e of entries) {
      const dateStr =
        (typeof e.time_entry_date === "string" && e.time_entry_date) ||
        (typeof e.start_datetime === "string" && String(e.start_datetime).slice(0, 10)) ||
        "";
      const q = quarterFromIsoDate(dateStr, year);
      if (!q || closed.has(q)) continue;
      const dur = parseDurationToSeconds(e.duration);
      const bill = parseDurationToSeconds(e.billable_duration ?? "00:00:00");
      agg[q].durationSec += dur;
      agg[q].billableSec += bill;
      if (classifyUtilizationEntry(e, resolver, activities, internalIds).counted) {
        agg[q].utilizationSec += dur;
      }
    }
  }

  return agg;
}

export type UtilizationBreakdownBucket = {
  seconds: number;
  hours: number;
  count: number;
  budgetTypesSeen?: Record<string, number>;
};

export type UtilizationBreakdown = Record<
  Quarter,
  {
    totalHours: number;
    countedHours: number;
    utilizationPct: number;
    buckets: Record<string, UtilizationBreakdownBucket>;
  }
>;

/**
 * Diagnostic twin of aggregateTimeForTeam's classification loop — tallies every
 * time entry into the exact branch of classifyUtilizationEntry() it fell into, so a
 * manual reconciliation can see precisely where hours landed (and why).
 */
export async function debugUtilizationBreakdown(
  team: ResolvedTeam,
  userIds: number[],
  year: number,
  projectsForUtilization: ScoroProject[] = []
): Promise<UtilizationBreakdown> {
  const yr = yearRange(year);
  const activities = await loadActivityLookup();
  const internalIds = await loadInternalNonBillableActivityIds();

  const bump = (
    store: Record<Quarter, Record<string, UtilizationBreakdownBucket>>,
    q: Quarter,
    bucket: string,
    dur: number,
    budgetTypeSeen?: string
  ) => {
    const b = (store[q][bucket] ??= { seconds: 0, hours: 0, count: 0 });
    b.seconds += dur;
    b.hours = +(b.seconds / 3600).toFixed(2);
    b.count += 1;
    if (budgetTypeSeen) {
      b.budgetTypesSeen ??= {};
      b.budgetTypesSeen[budgetTypeSeen] = (b.budgetTypesSeen[budgetTypeSeen] ?? 0) + dur;
    }
  };

  const buckets = {} as Record<Quarter, Record<string, UtilizationBreakdownBucket>>;
  for (const q of QUARTERS) buckets[q] = {};

  const entriesByUser: ScoroTimeEntry[][] = [];
  const calEventIds = new Set<number>();
  const taskEventIds = new Set<number>();
  for (const uid of userIds) {
    const entries = await fetchTimeEntriesForUser(uid, yr.from, yr.to);
    entriesByUser.push(entries);
    collectReferencedEventIds(entries, calEventIds, taskEventIds);
  }

  const resolver = await buildEntryProjectResolver(
    [...calEventIds],
    [...taskEventIds],
    projectsForUtilization
  );

  for (const entries of entriesByUser) {
    for (const e of entries) {
      const dateStr =
        (typeof e.time_entry_date === "string" && e.time_entry_date) ||
        (typeof e.start_datetime === "string" && String(e.start_datetime).slice(0, 10)) ||
        "";
      const q = quarterFromIsoDate(dateStr, year);
      if (!q) continue;
      const dur = parseDurationToSeconds(e.duration);
      if (dur === 0) continue;

      const result = classifyUtilizationEntry(e, resolver, activities, internalIds);
      const projectBudget = resolveEntryProjectBudget(e, resolver);
      const effective = projectBudget ? effectiveBudget(e, resolver, projectBudget) : null;
      const bucketName = result.counted ? `${result.reason}_COUNTED` : result.reason;
      bump(buckets, q, bucketName, dur, effective?.budgetTypeCode);
    }
  }

  const out = {} as UtilizationBreakdown;
  for (const q of QUARTERS) {
    let total = 0;
    let counted = 0;
    for (const [name, b] of Object.entries(buckets[q])) {
      total += b.seconds;
      if (name.includes("COUNTED")) counted += b.seconds;
    }
    out[q] = {
      totalHours: +(total / 3600).toFixed(2),
      countedHours: +(counted / 3600).toFixed(2),
      utilizationPct: total > 0 ? Math.round((100 * counted) / total) : 0,
      buckets: buckets[q],
    };
  }
  return out;
}

function toNumericId(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && /^\d+$/.test(x)) return Number(x);
  if (x && typeof x === "object") {
    const obj = x as Record<string, unknown>;
    // Scoro v2 project_users returns objects with user_id, not id
    if ("user_id" in obj) return toNumericId(obj.user_id);
    if ("id" in obj) return toNumericId(obj.id);
  }
  return null;
}

/**
 * Accounts Scoro attaches to a project (bookmark/responsible/participants).
 * When this set is empty we keep the row (assume the requesting bookmark_users filter applied).
 */
export function linkedUserIdsFromProject(p: ScoroProject): Set<number> {
  const ids = new Set<number>();
  const add = (v: unknown) => {
    const n = toNumericId(v);
    if (n != null && n > 0) ids.add(n);
  };
  const addMany = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) add(x);
  };

  addMany(p.bookmark_users);
  addMany((p as { related_users?: unknown }).related_users);
  addMany((p as { project_users?: unknown }).project_users);
  addMany((p as { users?: unknown }).users);
  addMany((p as { participating_users?: unknown }).participating_users);
  add((p as { user_id?: unknown }).user_id);
  add((p as { manager_id?: unknown }).manager_id);
  add((p as { project_manager_id?: unknown }).project_manager_id);
  add((p as { responsible_user_id?: unknown }).responsible_user_id);

  const single = (p as { bookmark_user_id?: unknown }).bookmark_user_id;
  add(single);

  return ids;
}

/**
 * Keep projects visibly tied to this team's Scoro roster so KPIs and escalation tags
 * are not duplicated across every row when the projects/list response over-shares bookmarks.
 */
export function filterProjectsToTeamParticipants(
  projects: ScoroProject[],
  teamUserIds: number[]
): ScoroProject[] {
  const team = new Set(teamUserIds.filter((n) => Number.isFinite(n) && n > 0));
  if (team.size === 0) return projects;
  let emptyLinkedCount = 0;
  const result = projects.filter((p) => {
    const linked = linkedUserIdsFromProject(p);
    if (linked.size === 0) {
      emptyLinkedCount++;
      return bookmarkOverlapCount(teamUserIds, p) > 0;
    }
    for (const id of linked) {
      if (team.has(id)) return true;
    }
    return false;
  });
  if (emptyLinkedCount > 0) {
    console.warn(
      `[scoro] filterProjectsToTeamParticipants [${teamUserIds.join(",")}]: ${emptyLinkedCount}/${projects.length} projects had empty linkedUserIds (project_users format issue?)`
    );
  }
  return result;
}

function participationScore(teamUserIds: number[], linked: Set<number>): number {
  const team = new Set(teamUserIds);
  let n = 0;
  for (const id of linked) {
    if (team.has(id)) n++;
  }
  return n;
}

/** How many of this team's Scoro users appear on project bookmark_users (primary ownership signal). */
function bookmarkOverlapCount(teamUserIds: number[], p: ScoroProject): number {
  const team = new Set(teamUserIds.filter((n) => Number.isFinite(n) && n > 0));
  const bu = p.bookmark_users;
  if (!Array.isArray(bu) || team.size === 0) return 0;
  let n = 0;
  for (const x of bu) {
    const id = toNumericId(x);
    if (id != null && team.has(id)) n++;
  }
  return n;
}

function stableProjectKey(p: ScoroProject): string {
  const pid = Number(p.project_id);
  if (Number.isFinite(pid) && pid > 0) return `id:${Math.floor(pid)}`;
  const name = String(p.project_name ?? "").slice(0, 240);
  const d =
    (typeof p.deadline === "string" && p.deadline) ||
    (typeof p.date === "string" && p.date) ||
    "";
  return `noid:${name}\0${d}`;
}

function pickExclusiveProjectOwner(
  contenders: { team: ResolvedTeam; userIds: number[]; project: ScoroProject }[]
): { team: ResolvedTeam; userIds: number[]; project: ScoroProject } {
  if (contenders.length === 1) return contenders[0];

  const scored = contenders.map((c) => {
    const linked = linkedUserIdsFromProject(c.project);
    return {
      c,
      part: participationScore(c.userIds, linked),
      bookmarks: bookmarkOverlapCount(c.userIds, c.project),
    };
  });

  scored.sort((a, b) => {
    if (b.part !== a.part) return b.part - a.part;
    if (b.bookmarks !== a.bookmarks) return b.bookmarks - a.bookmarks;
    return a.c.team.code.localeCompare(b.c.team.code);
  });

  return scored[0].c;
}

export type TeamProjectFetch = {
  team: ResolvedTeam;
  userIds: number[];
  projects: ScoroProject[];
};

/**
 * Each Scoro project is counted for at most one team on a director: the team with the strongest
 * roster overlap (linked users, then bookmarks). Stops identical FTA / estimate / pitch KPIs
 * when the same jobs appear on every team's bookmark list.
 */
export function assignProjectsExclusiveToTeams(
  bundles: TeamProjectFetch[]
): Map<string, ScoroProject[]> {
  const byKey = new Map<
    string,
    { team: ResolvedTeam; userIds: number[]; project: ScoroProject }[]
  >();

  for (const b of bundles) {
    for (const p of b.projects) {
      const key = stableProjectKey(p);
      const arr = byKey.get(key) ?? [];
      arr.push({ team: b.team, userIds: b.userIds, project: p });
      byKey.set(key, arr);
    }
  }

  const out = new Map<string, ScoroProject[]>();
  for (const b of bundles) {
    out.set(b.team.code, []);
  }

  for (const [, contenders] of byKey) {
    const w = pickExclusiveProjectOwner(contenders);
    out.get(w.team.code)!.push(w.project);
  }

  return out;
}

function customField(p: ScoroProject, name: string): string | null {
  const cf = p.custom_fields;
  if (!Array.isArray(cf)) return null;
  for (const row of cf as { name?: string; value?: unknown }[]) {
    if (
      String(row.name ?? "").trim().toLowerCase() === name.toLowerCase() &&
      row.value != null &&
      row.value !== ""
    )
      return String(row.value);
  }
  return null;
}

function projectTags(p: ScoroProject): string[] {
  // v4 API returns tagNames as string[]; v2 returns tags as [{id,name}] or string[]
  const raw =
    (p as { tagNames?: unknown }).tagNames ??
    (p as { tags?: unknown }).tags;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((x) =>
      typeof x === "string"
        ? x.toLowerCase()
        : typeof x === "object" && x && "name" in (x as object)
          ? String((x as { name?: string }).name ?? "").toLowerCase()
          : ""
    )
    .filter(Boolean);
}

function hasTag(p: ScoroProject, needle: string): boolean {
  const n = needle.toLowerCase();
  return projectTags(p).some((t) => t.includes(n));
}

function isCompletedOrInvoiced(p: ScoroProject): boolean {
  const s = String(p.status ?? "").toLowerCase();
  if (s === "completed" || s === "invoiced" || s === "additional6") return true;
  // v2 uses status_name; v4 uses statusName
  const sn = String(
    p.status_name ?? (p as { statusName?: unknown }).statusName ?? ""
  ).toLowerCase();
  return sn === "completed" || sn === "invoiced";
}

function isClientProject(p: ScoroProject): boolean {
  // v2 uses project_type / is_personal; v4 uses projectType / isPersonal
  const type = String(
    p.project_type ?? (p as { projectType?: unknown }).projectType ?? ""
  ).toLowerCase();
  if (type === "internal") return false;
  const personal =
    p.is_personal ?? (p as { isPersonal?: unknown }).isPersonal;
  if (personal === 1 || personal === "1" || personal === true) return false;
  return true;
}

function budgetTypeLabel(p: ScoroProject): string {
  // v4 API returns customFields as {c_budgettype: "CE"} (object keyed by field id)
  const cf4 = (p as { customFields?: Record<string, unknown> }).customFields;
  if (cf4 && typeof cf4.c_budgettype === "string" && cf4.c_budgettype) {
    return cf4.c_budgettype.toLowerCase().trim();
  }
  // v2 API returns custom_fields as [{name: "Budget Type", value: "CE"}]
  return String(
    customField(p, "Budget Type") ??
      (p as { budget_type_label?: unknown }).budget_type_label ??
      p.budget_type ??
      ""
  )
    .toLowerCase()
    .trim();
}

function budgetTypeCode(p: ScoroProject): string {
  const label = budgetTypeLabel(p);
  if (label.includes("new business")) return "new business";
  const m = label.match(/\b(ce|op|bm|ret)\b/i);
  return m ? m[1].toLowerCase() : label;
}

function isNewBusinessBudget(p: ScoroProject): boolean {
  const v = budgetTypeLabel(p);
  return v.includes("new business");
}

function isExistingClientBudget(p: ScoroProject): boolean {
  const v = budgetTypeLabel(p);
  if (!v || isNewBusinessBudget(p)) return false;
  return /\b(ce|op|bm|ret)\b/i.test(v);
}

function projectQuarter(p: ScoroProject, year: number): Quarter | null {
  // Legacy deadline bucketing (pitch project path only).
  const v4DueDate = (p as { dueDate?: unknown }).dueDate;
  const d =
    (typeof p.deadline === "string" && p.deadline) ||
    (typeof v4DueDate === "string" && v4DueDate.slice(0, 10)) ||
    (typeof p.date === "string" && p.date) ||
    "";
  return quarterFromIsoDate(d, year);
}

/** Completion / close date for FTA & Projects in Estimate (Rafal: not deadline). */
export function projectCompletionDateIso(p: ScoroProject): string {
  const v4Completed = (p as { completedDate?: unknown }).completedDate;
  if (typeof v4Completed === "string" && v4Completed.length >= 10) {
    return v4Completed.slice(0, 10);
  }
  for (const key of ["completed_date", "datetime_completed", "date_completed"] as const) {
    const v = p[key];
    if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  }
  if (isCompletedOrInvoiced(p)) {
    const v4Modified = (p as { modifiedDateTime?: unknown }).modifiedDateTime;
    if (typeof v4Modified === "string" && v4Modified.length >= 10) {
      return v4Modified.slice(0, 10);
    }
    if (typeof p.modified_date === "string" && p.modified_date.length >= 10) {
      return String(p.modified_date).slice(0, 10);
    }
  }
  return "";
}

export function projectCompletionQuarter(p: ScoroProject, year: number): Quarter | null {
  return quarterFromIsoDate(projectCompletionDateIso(p), year);
}

/** Quoted vs actual style totals from Scoro (preferred when present). */
type BudgetEntry = {
  estimatedCost: number;
  actualCost: number;
  budgetedSum?: number;
  usedBudget?: number;
};

const BUDGET_EPS = 0.01;

let _budgetCache: Map<number, BudgetEntry> | null = null;

/** Comparable cap vs used for "within estimate" (higher values = more spend). */
function budgetPairFromCache(b: BudgetEntry): { cap: number; used: number } | null {
  const bs = b.budgetedSum;
  const ub = b.usedBudget;
  if (
    typeof bs === "number" &&
    Number.isFinite(bs) &&
    typeof ub === "number" &&
    Number.isFinite(ub) &&
    (bs > 0 || ub > 0)
  ) {
    return { cap: bs, used: ub };
  }
  const ec = b.estimatedCost;
  const ac = b.actualCost;
  if ((typeof ec === "number" && ec > 0) || (typeof ac === "number" && ac > 0)) {
    return { cap: ec, used: ac };
  }
  return null;
}

function projectBudgetPair(p: ScoroProject): { cap: number; used: number } | null {
  const pairs: [unknown, unknown][] = [
    [p.budget_cost, p.actual_cost],
    [p.estimated_cost, p.actual_cost],
    [p.estimated_cost, p.real_cost],
    [(p as { project_budget?: unknown }).project_budget, p.actual_cost],
    [(p as { total_budget?: unknown }).total_budget, (p as { total_cost?: unknown }).total_cost],
  ];
  for (const [capRaw, usedRaw] of pairs) {
    const cap = Number(capRaw);
    const used = Number(usedRaw);
    // Require cap > 0: a project with no budget set (cap=0) is not
    // meaningful estimate data — it would always appear "over budget".
    if (Number.isFinite(cap) && cap > 0 && Number.isFinite(used)) {
      return { cap, used };
    }
  }
  return null;
}

function withinBudgetCap(cap: number, used: number): boolean {
  return used <= cap + BUDGET_EPS;
}

function loadBudgetCache(): Map<number, BudgetEntry> {
  if (_budgetCache) return _budgetCache;
  _budgetCache = new Map();
  try {
    // budgets.json is committed to the repo and available read-only in all
    // environments (local dev and Vercel's /var/task filesystem).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const fp = path.join(process.cwd(), "data", "budgets.json");
    const raw = JSON.parse(fs.readFileSync(fp, "utf8")) as Record<string, BudgetEntry>;
    for (const [id, entry] of Object.entries(raw)) {
      _budgetCache.set(Number(id), entry);
    }
    console.log(`[budget] Loaded ${_budgetCache.size} project budgets`);
  } catch {
    console.warn("[budget] data/budgets.json not found — Projects in Estimate will show 0%");
  }
  return _budgetCache;
}

/**
 * "Projects in Estimate" — budget cost vs actual cost.
 * Reads pre-fetched budget data from data/budgets.json (populated via
 * the Scoro v4 API / MCP). Falls back to v2 fields if present.
 */
function projectNumericId(p: ScoroProject): number {
  // Scoro v2 may return the ID as "project_id" or "id"
  const a = Number(p.project_id);
  if (Number.isFinite(a) && a > 0) return a;
  const b = Number((p as { id?: unknown }).id);
  if (Number.isFinite(b) && b > 0) return b;
  return NaN;
}

function inEstimateSuccess(p: ScoroProject): boolean {
  if (!isCompletedOrInvoiced(p)) return false;
  const pid = projectNumericId(p);

  const budgets = loadBudgetCache();
  const b = Number.isFinite(pid) ? budgets.get(pid) : undefined;
  if (b) {
    const pair = budgetPairFromCache(b);
    if (pair) return withinBudgetCap(pair.cap, pair.used);
  }

  const fromProject = projectBudgetPair(p);
  if (fromProject) return withinBudgetCap(fromProject.cap, fromProject.used);

  return false;
}

function hasEstimateData(p: ScoroProject): boolean {
  const pid = projectNumericId(p);
  const budgets = loadBudgetCache();
  const b = Number.isFinite(pid) ? budgets.get(pid) : undefined;
  if (b && budgetPairFromCache(b)) return true;

  return projectBudgetPair(p) != null;
}

/**
 * Returns the budgeted / quoted value of a project in CHF for pitch weighting.
 * Priority: budgetedSum from budgets.json → estimatedCost from budgets.json →
 * Scoro project budget fields. Returns 0 when no data is available.
 */
function projectBudgetValue(p: ScoroProject): number {
  const pid = projectNumericId(p);
  const budgets = loadBudgetCache();
  const b = Number.isFinite(pid) ? budgets.get(pid) : undefined;
  if (b) {
    const bs = b.budgetedSum;
    if (typeof bs === "number" && Number.isFinite(bs) && bs > 0) return bs;
    const ec = b.estimatedCost;
    if (typeof ec === "number" && Number.isFinite(ec) && ec > 0) return ec;
  }
  const cap = Number(
    (p as { budget_cost?: unknown }).budget_cost ??
      (p as { estimated_cost?: unknown }).estimated_cost ??
      (p as { project_budget?: unknown }).project_budget ??
      (p as { total_budget?: unknown }).total_budget ??
      0
  );
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

/**
 * Pitch weight based on project value in CHF.
 * Bands: <20k = 1  (spec defines <10k=1; 10k–20k is unspecified — treated as 1),
 *        20k–50k = 2,  >50k = 3.
 */
function pitchWeight(valueCHF: number): 1 | 2 | 3 {
  if (valueCHF >= 50_000) return 3;
  if (valueCHF >= 20_000) return 2;
  return 1;
}

export async function fetchProjectsForTeamUserIds(
  userIds: number[]
): Promise<ScoroProject[]> {
  if (userIds.length === 0) return [];

  // Fetch per-user using the single-user participant filter (user_id is the
  // reliable Scoro v2 filter key). Then merge and deduplicate by project_id.
  // This is more reliable than bookmark_users, which only returns projects that
  // team members have manually bookmarked in Scoro's "My Projects" view.
  const perUserResults = await Promise.all(
    userIds.map((uid) =>
      scoroListAllPages<ScoroProject>("projects/list", {
        filter: { user_id: uid },
        detailed: true,
        maxPages: 60,
      })
    )
  );

  const seen = new Set<number>();
  const merged: ScoroProject[] = [];
  for (const projects of perUserResults) {
    for (const p of projects) {
      const id = Number(p.project_id ?? p.id);
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(p);
      }
    }
  }

  if (merged.length > 0) {
    console.log(
      `[scoro] fetchProjectsForTeamUserIds [${userIds.join(",")}]: found ${merged.length} projects via per-user participant filter`
    );
    return merged;
  }

  // Fallback: bookmark-based filter (for teams that manage bookmarks explicitly)
  console.warn(
    `[scoro] projects/list user_id filter returned 0 for all users [${userIds.join(",")}] — falling back to bookmark_users`
  );
  return scoroListAllPages<ScoroProject>("projects/list", {
    bookmark: { bookmark_users: userIds },
    detailed: true,
    maxPages: 60,
  });
}

export function computeProjectKpisByQuarter(
  projects: ScoroProject[],
  year: number
): {
  fta: Record<Quarter, number>;
  estimate: Record<Quarter, number>;
  newBizWin: Record<Quarter, number>;
  existingWin: Record<Quarter, number>;
  analyzed: { fta: number; estimate: number; newBizWin: number; existingWin: number };
  // Raw counts per quarter for agent explanations
  debug: {
    fta: Record<Quarter, { numerator: number; denominator: number }>;
    estimate: Record<Quarter, { numerator: number; denominator: number }>;
    newBizWin: Record<Quarter, { numerator: number; denominator: number }>;
    existingWin: Record<Quarter, { numerator: number; denominator: number }>;
  };
} {
  const zeros = () =>
    Object.fromEntries(QUARTERS.map((q) => [q, 0])) as Record<Quarter, number>;
  const zeroCounts = () =>
    Object.fromEntries(QUARTERS.map((q) => [q, { numerator: 0, denominator: 0 }])) as Record<
      Quarter,
      { numerator: number; denominator: number }
    >;

  const fta = zeros();
  const estimate = zeros();
  const newBizWin = zeros();
  const existingWin = zeros();
  const analyzed = { fta: 0, estimate: 0, newBizWin: 0, existingWin: 0 };
  const debug = {
    fta: zeroCounts(),
    estimate: zeroCounts(),
    newBizWin: zeroCounts(),
    existingWin: zeroCounts(),
  };

  const noQuarter = projects.filter(
    (p) => projectCompletionQuarter(p, year) === null && isClientProject(p) && isCompletedOrInvoiced(p)
  );
  if (noQuarter.length > 0) {
    console.log(`[kpi] ${noQuarter.length}/${projects.length} completed client projects have no ${year} completion date — excluded from FTA/estimate quarter buckets`);
  }

  // One-time diagnostic: log the raw shape of the first project so we can verify
  // that tags and custom_fields are being returned by the v2 API as expected.
  if (projects.length > 0) {
    const sample = projects[0];
    const sampleKeys = Object.keys(sample).join(", ");
    const sampleTags = JSON.stringify((sample as { tags?: unknown; tagNames?: unknown }).tags ?? (sample as { tagNames?: unknown }).tagNames ?? null);
    const sampleCf = JSON.stringify((sample as { custom_fields?: unknown; customFields?: unknown }).custom_fields ?? (sample as { customFields?: unknown }).customFields ?? null);
    console.log(`[kpi:diag] sample project keys: ${sampleKeys}`);
    console.log(`[kpi:diag] sample tags field: ${sampleTags}`);
    console.log(`[kpi:diag] sample custom_fields: ${String(sampleCf).slice(0, 200)}`);
    console.log(`[kpi:diag] sample status: ${String(sample.status)} | status_name: ${String((sample as { status_name?: unknown }).status_name ?? (sample as { statusName?: unknown }).statusName ?? "")}`);
    console.log(`[kpi:diag] sample deadline/dueDate: ${String(sample.deadline ?? (sample as { dueDate?: unknown }).dueDate ?? "")}`);
  }

  for (const q of QUARTERS) {
    const pool = projects.filter(
      (p) =>
        projectCompletionQuarter(p, year) === q &&
        isClientProject(p) &&
        isCompletedOrInvoiced(p)
    );
    const completed = pool;

    const ftaDenom = completed.length;
    const ftaNum = completed.filter((p) => hasTag(p, "fta")).length;
    fta[q] = ftaDenom ? Math.round((100 * ftaNum) / ftaDenom) : 0;
    debug.fta[q] = { numerator: ftaNum, denominator: ftaDenom };
    analyzed.fta += ftaDenom;

    const estPool = completed.filter((p) => hasEstimateData(p));
    const estNum = estPool.filter((p) => inEstimateSuccess(p)).length;
    estimate[q] = estPool.length ? Math.round((100 * estNum) / estPool.length) : 0;
    debug.estimate[q] = { numerator: estNum, denominator: estPool.length };
    analyzed.estimate += estPool.length;
    if (estPool.length > 0) {
      console.log(`[kpi] estimate ${q}: ${estNum}/${estPool.length} within budget (${estimate[q]}%)`);
    }

    const pitchNb = pool.filter((p) => hasTag(p, "pitch") && isNewBusinessBudget(p));
    const wonNb = pitchNb.filter(isCompletedOrInvoiced);
    const pitchNbWeightTotal = pitchNb.reduce((s, p) => s + pitchWeight(projectBudgetValue(p)), 0);
    const wonNbWeightTotal  = wonNb.reduce((s, p) => s + pitchWeight(projectBudgetValue(p)), 0);
    newBizWin[q] = pitchNbWeightTotal > 0 ? Math.round((100 * wonNbWeightTotal) / pitchNbWeightTotal) : 0;
    debug.newBizWin[q] = { numerator: wonNbWeightTotal, denominator: pitchNbWeightTotal };
    analyzed.newBizWin += pitchNb.length;

    const pitchEx = pool.filter((p) => hasTag(p, "pitch") && isExistingClientBudget(p));
    const wonEx = pitchEx.filter(isCompletedOrInvoiced);
    const pitchExWeightTotal = pitchEx.reduce((s, p) => s + pitchWeight(projectBudgetValue(p)), 0);
    const wonExWeightTotal   = wonEx.reduce((s, p) => s + pitchWeight(projectBudgetValue(p)), 0);
    existingWin[q] = pitchExWeightTotal > 0 ? Math.round((100 * wonExWeightTotal) / pitchExWeightTotal) : 0;
    debug.existingWin[q] = { numerator: wonExWeightTotal, denominator: pitchExWeightTotal };
    analyzed.existingWin += pitchEx.length;
  }

  return { fta, estimate, newBizWin, existingWin, analyzed, debug };
}

function normalizedStatusCombined(p: ScoroProject): string {
  const a = `${p.status ?? ""}`.toLowerCase();
  const b = `${(p as { status_name?: string }).status_name ?? ""}`.toLowerCase();
  return `${a} ${b}`.trim();
}

const EXCLUDED_ACTIVE_PROJECT_BUDGET_RE =
  /\b(admind\s*project|growth|barter|business\s*development)\b/i;

/** Human-readable Scoro project status for UI / agent explanations. */
export function projectStatusLabel(p: ScoroProject): string {
  const name = String(
    p.status_name ?? (p as { statusName?: unknown }).statusName ?? ""
  ).trim();
  if (name) return name;
  const code = String(p.status ?? "").trim();
  return code || "Unknown";
}

/** Terminal = completed/invoiced in Scoro, or explicitly cancelled. */
export function isTerminalProject(p: ScoroProject): boolean {
  if (isCompletedOrInvoiced(p)) return true;
  const blob = normalizedStatusCombined(p);
  if (!blob.length) return false;
  return /\b(cancelled|canceled)\b/.test(blob);
}

/** Exclude internal / non-client workload types from the active-projects count. */
export function isExcludedActiveProjectBudget(p: ScoroProject): boolean {
  return EXCLUDED_ACTIVE_PROJECT_BUDGET_RE.test(budgetTypeLabel(p));
}

/**
 * Count non-terminal client projects where the design lead has task assignments.
 * Excludes budget types: Admind Project, Growth, Barter.
 */
export function activeProjectCount(projects: ScoroProject[]): number {
  return projects.filter((p) => !isTerminalProject(p) && !isExcludedActiveProjectBudget(p)).length;
}

export function buildActiveProjectDetails(
  projects: ScoroProject[],
  openTasks: ScoroTask[]
): ActiveProjectDetail[] {
  const counts = new Map<number, number>();
  for (const t of openTasks) {
    const pid = taskProjectId(t);
    if (pid != null) counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }

  return projects
    .map((p) => {
      const pid = projectNumericId(p);
      if (!Number.isFinite(pid) || pid <= 0) return null;
      return {
        projectId: pid,
        name: String(p.project_name ?? "Untitled"),
        status: projectStatusLabel(p),
        budgetType: budgetTypeLabel(p) || "—",
        openTaskCount: counts.get(pid) ?? 0,
      };
    })
    .filter((row): row is ActiveProjectDetail => row != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

type ScoroTask = Record<string, unknown>;

// ── Task tag helpers (c_tasktag custom field) ────────────────────────────────

function taskCustomFieldValue(t: ScoroTask, fieldId: string): string {
  const id = fieldId.toLowerCase();
  const cf4 = t.customFields as Record<string, unknown> | undefined;
  if (cf4 && typeof cf4[fieldId] === "string" && cf4[fieldId]) return cf4[fieldId] as string;

  const cf2 = t.custom_fields;
  if (Array.isArray(cf2)) {
    for (const row of cf2 as { id?: string; name?: string; value?: unknown }[]) {
      const rowId = String(row.id ?? "").toLowerCase();
      const rowName = String(row.name ?? "").toLowerCase().replace(/[\s_-]+/g, "");
      const idTail = id.replace(/^c_/, "");
      if (rowId !== id && rowName !== idTail) continue;
      if (row.value != null && row.value !== "") return String(row.value);
    }
  } else if (cf2 && typeof cf2 === "object") {
    const val = (cf2 as Record<string, unknown>)[fieldId];
    if (typeof val === "string" && val) return val;
  }
  return "";
}

/** Read the raw `c_tasktag` value from either v2 or v4 custom-field formats. */
export function getTaskTagValue(t: ScoroTask): string {
  return taskCustomFieldValue(t, "c_tasktag");
}

function hasTaskEscalationTag(t: ScoroTask): boolean {
  return /escalation/i.test(getTaskTagValue(t));
}

// ── Pitch task tag parsing & weighting ───────────────────────────────────────

const PITCH_TAG_PATTERNS: { pattern: RegExp; weight: 1 | 2 | 3 }[] = [
  { pattern: /pitch\s*\(\s*<\s*10k/i, weight: 1 },
  { pattern: /pitch\s*\(\s*10\s*[-–—]\s*50k/i, weight: 2 },
  { pattern: /pitch\s*\(\s*10.{0,3}50k/i, weight: 2 },
  { pattern: /pitch\s*\(\s*>\s*50k/i, weight: 3 },
];

/** Returns the pitch weight (1/2/3) if the task tag is a pitch tier, else null. */
export function pitchWeightFromTag(tagValue: string): 1 | 2 | 3 | null {
  for (const { pattern, weight } of PITCH_TAG_PATTERNS) {
    if (pattern.test(tagValue)) return weight;
  }
  return null;
}

// ── Business Area (task-level custom field) ──────────────────────────────────

export function getTaskBusinessArea(t: ScoroTask): string {
  return (
    taskCustomFieldValue(t, "c_businessarea") ||
    taskCustomFieldValue(t, "c_business_area")
  );
}

export function getTaskBudgetType(t: ScoroTask): string {
  return taskCustomFieldValue(t, "c_budgettype");
}

function isNewBusinessArea(area: string): boolean {
  return /new\s*business/i.test(area);
}

/** Classify pitch tasks as New Business vs existing-client using Business area only. */
export function isNewBusinessPitchTask(t: ScoroTask): boolean {
  return isNewBusinessArea(getTaskBusinessArea(t));
}

export function isTaskCompleted(t: ScoroTask): boolean {
  if (t.is_completed === 1 || t.is_completed === "1" || t.is_completed === true) return true;
  if (typeof t.datetime_completed === "string" && t.datetime_completed.length >= 10) return true;

  const blob = `${t.status ?? ""} ${(t as { status_name?: string }).status_name ?? ""}`.toLowerCase();
  return /\b(completed|done|invoiced)\b/.test(blob);
}

function taskProjectId(t: ScoroTask): number | null {
  const pid = Number(t.project_id ?? (t as { projectId?: unknown }).projectId);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function taskDateIso(t: ScoroTask): string {
  return (
    (typeof t.datetime_due === "string" && t.datetime_due.slice(0, 10)) ||
    (typeof t.due_date === "string" && t.due_date.slice(0, 10)) ||
    (typeof t.start_datetime === "string" && t.start_datetime.slice(0, 10)) ||
    (typeof t.modified_date === "string" && String(t.modified_date).slice(0, 10)) ||
    (typeof t.created_date === "string" && String(t.created_date).slice(0, 10)) ||
    ""
  );
}

// ── Offer prep projects bookmark exclusion ───────────────────────────────────

const DEFAULT_OFFER_PREP_BOOKMARK_NAME = "All Offer Prep projects";

type ScoroBookmark = { bookmark_id: number; title: string };

let _offerPrepBookmarkId: number | null | undefined;
let _offerPrepIds: Set<number> | null = null;
let _pitchCandidateTasks: ScoroTask[] | null = null;
let _pitchCandidateTasksYear: number | null = null;

const TASK_USER_FILTER_KEYS = ["doer_id", "owner_id", "user_id", "assigned_to"] as const;
/** Open-task discovery for design leads — broader than TASK_USER_FILTER_KEYS alone. */
const LEAD_OPEN_TASK_FILTER_KEYS = [
  "doer_id",
  "assigned_to",
  "responsible_id",
  "responsible_user_id",
] as const;

/** Normalize bookmark titles for reliable exact matching (trim, collapse whitespace, lowercase). */
export function normalizeBookmarkTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Find a projects bookmark by title. Uses case-insensitive exact match only —
 * avoids partial matches that could exclude the wrong projects.
 */
export function findProjectBookmarkByTitle(
  bookmarks: ScoroBookmark[],
  name: string
): ScoroBookmark | null {
  const target = normalizeBookmarkTitle(name);
  if (!target) return null;

  const matches = bookmarks.filter(
    (b) => typeof b.bookmark_id === "number" && normalizeBookmarkTitle(b.title) === target
  );
  if (matches.length === 1) return matches[0];
  return null;
}

async function fetchProjectBookmarks(): Promise<ScoroBookmark[]> {
  const res = await scoroPostUser<ScoroBookmark[]>("bookmarks/list", {
    request: { module: "projects" },
  });
  const rows = Array.isArray(res?.data) ? res!.data : [];
  return rows.filter(
    (b): b is ScoroBookmark =>
      typeof b.bookmark_id === "number" && typeof b.title === "string"
  );
}

async function persistOfferPrepBookmarkId(id: number): Promise<void> {
  const meta = await readMeta();
  if (meta.offerPrepBookmarkId === id) return;
  await writeMeta({ ...meta, offerPrepBookmarkId: id });
}

/**
 * Resolve the Offer prep projects bookmark ID.
 * Priority: SCORO_OFFER_PREP_BOOKMARK_ID → Redis meta → name lookup via bookmarks/list
 * (requires SCORO_USER_TOKEN or SCORO_USER_USERNAME/PASSWORD).
 */
async function resolveOfferPrepBookmarkId(): Promise<number | null> {
  if (_offerPrepBookmarkId !== undefined) return _offerPrepBookmarkId;

  const idRaw = process.env.SCORO_OFFER_PREP_BOOKMARK_ID?.trim();
  if (idRaw) {
    const id = Number(idRaw);
    if (Number.isFinite(id) && id > 0) {
      console.log(`[pitch] Offer-prep bookmark from SCORO_OFFER_PREP_BOOKMARK_ID=${id}`);
      _offerPrepBookmarkId = id;
      return id;
    }
    console.warn(`[pitch] Invalid SCORO_OFFER_PREP_BOOKMARK_ID="${idRaw}" — falling back`);
  }

  const meta = await readMeta();
  if (typeof meta.offerPrepBookmarkId === "number" && meta.offerPrepBookmarkId > 0) {
    console.log(`[pitch] Offer-prep bookmark from cache → id ${meta.offerPrepBookmarkId}`);
    _offerPrepBookmarkId = meta.offerPrepBookmarkId;
    return meta.offerPrepBookmarkId;
  }

  const token = await resolveScoroUserToken();
  if (!token) {
    console.warn(
      "[pitch] bookmarks/list requires a Scoro user token — set SCORO_USER_TOKEN or SCORO_USER_USERNAME/PASSWORD, or set SCORO_OFFER_PREP_BOOKMARK_ID"
    );
    _offerPrepBookmarkId = null;
    return null;
  }

  const name =
    process.env.SCORO_OFFER_PREP_BOOKMARK_NAME?.trim() || DEFAULT_OFFER_PREP_BOOKMARK_NAME;

  try {
    const bookmarks = await fetchProjectBookmarks();
    const match = findProjectBookmarkByTitle(bookmarks, name);

    if (match) {
      console.log(
        `[pitch] Resolved offer-prep bookmark "${match.title}" → id ${match.bookmark_id}`
      );
      _offerPrepBookmarkId = match.bookmark_id;
      await persistOfferPrepBookmarkId(match.bookmark_id);
      return match.bookmark_id;
    }

    const available = bookmarks.map((b) => `"${b.title}" (${b.bookmark_id})`).join(", ");
    console.warn(
      `[pitch] No projects bookmark matched "${name}". Available: ${available || "(none)"}`
    );
  } catch (e) {
    console.warn("[pitch] Failed to resolve offer-prep bookmark by name:", e);
  }

  _offerPrepBookmarkId = null;
  return null;
}

/** Fetch project IDs from the Offer prep projects bookmark (completed pitch on these = lost). */
async function loadOfferPrepProjectIds(): Promise<Set<number>> {
  if (_offerPrepIds) return _offerPrepIds;

  const bookmarkId = await resolveOfferPrepBookmarkId();
  if (bookmarkId === null) {
    console.warn("[pitch] Offer-prep bookmark unavailable — won/lost detection disabled for pitch tasks");
    _offerPrepIds = new Set();
    return _offerPrepIds;
  }

  if (!(await resolveScoroUserToken())) {
    console.warn("[pitch] Cannot load offer-prep projects without user token (bookmark_id filter is user-scoped)");
    _offerPrepIds = new Set();
    return _offerPrepIds;
  }

  try {
    const projects = await scoroListAllPagesUser<ScoroProject>("projects/list", {
      bookmark: { bookmark_id: bookmarkId },
      maxPages: 40,
    });
    _offerPrepIds = new Set<number>();
    for (const p of projects) {
      const pid = projectNumericId(p);
      if (Number.isFinite(pid) && pid > 0) _offerPrepIds.add(pid);
    }
    console.log(
      `[pitch] Loaded ${_offerPrepIds.size} offer-prep project IDs for pitch win/loss (bookmark ${bookmarkId})`
    );
  } catch (e) {
    console.warn("[pitch] Failed to load offer-prep bookmark projects:", e);
    _offerPrepIds = new Set();
  }
  return _offerPrepIds;
}

function stableTaskEventId(t: ScoroTask): number | null {
  const eventId = Number(t.event_id);
  if (Number.isFinite(eventId) && eventId > 0) return eventId;
  const taskId = Number(t.task_id ?? t.id);
  return Number.isFinite(taskId) && taskId > 0 ? taskId : null;
}

/** Merge tasks/list results for each user across Scoro's user filter keys. */
async function fetchTasksForUserIds(
  userIds: number[],
  year?: number
): Promise<ScoroTask[]> {
  if (userIds.length === 0) return [];

  const dateFilter =
    year != null
      ? { modified_date: { from_date: yearRange(year).from, to_date: yearRange(year).to } }
      : {};
  const seen = new Set<number>();
  const merged: ScoroTask[] = [];

  for (const uid of userIds) {
    for (const key of TASK_USER_FILTER_KEYS) {
      const tasks = await scoroListAllPages<ScoroTask>("tasks/list", {
        filter: { [key]: uid, ...dateFilter },
        detailed: true,
        maxPages: 40,
      });
      for (const t of tasks) {
        const id = stableTaskEventId(t);
        if (id != null && seen.has(id)) continue;
        if (id != null) seen.add(id);
        merged.push(t);
      }
    }
  }

  return merged;
}

/** Open tasks assigned to the design lead (Scoro is_completed=0 + assignee verification). */
async function fetchOpenTasksForLead(leadId: number): Promise<ScoroTask[]> {
  const seen = new Set<number>();
  const merged: ScoroTask[] = [];

  for (const key of LEAD_OPEN_TASK_FILTER_KEYS) {
    const tasks = await scoroListAllPages<ScoroTask>("tasks/list", {
      filter: { [key]: leadId, is_completed: 0 },
      detailed: true,
      maxPages: 40,
    });
    for (const t of tasks) {
      const id = stableTaskEventId(t);
      if (id != null && seen.has(id)) continue;
      if (id != null) seen.add(id);
      merged.push(t);
    }
  }

  return merged.filter(
    (t) => !isTaskCompleted(t) && taskAssigneeUserIds(t).includes(leadId)
  );
}

/**
 * All tasks (open + completed) linked to the design lead, bounded to modified
 * since Jan 1 of the PRIOR year. Unbounded would mean re-fetching a multi-year
 * lead's entire task history (600+ tasks) on every sync even though only
 * projects completing in the current KPI year matter — a project that
 * started last year and completed this year still has its start-of-work task
 * modified within this window, so nothing this year's FTA/estimate KPIs need
 * is excluded.
 */
async function fetchAllTasksForLead(leadId: number, year: number): Promise<ScoroTask[]> {
  const seen = new Set<number>();
  const merged: ScoroTask[] = [];
  const modified_date = { from_date: `${year - 1}-01-01`, to_date: yearRange(year).to };

  for (const key of LEAD_OPEN_TASK_FILTER_KEYS) {
    const tasks = await scoroListAllPages<ScoroTask>("tasks/list", {
      filter: { [key]: leadId, modified_date },
      detailed: true,
      maxPages: 40,
    });
    for (const t of tasks) {
      const id = stableTaskEventId(t);
      if (id != null && seen.has(id)) continue;
      if (id != null) seen.add(id);
      merged.push(t);
    }
  }

  return merged.filter((t) => taskAssigneeUserIds(t).includes(leadId));
}

function isInternalNonBillableTask(
  t: ScoroTask,
  internalIds: Set<number>
): boolean {
  return isInternalNonBillableActivityId(activityIdFromEntry(t), internalIds);
}

async function filterTasksForActiveProjects(tasks: ScoroTask[]): Promise<ScoroTask[]> {
  const internalIds = await loadInternalNonBillableActivityIds();
  return tasks.filter((t) => !isInternalNonBillableTask(t, internalIds));
}

/** Merge tasks/list results for each roster user across Scoro's user filter keys. */
async function fetchTasksForTeamUserIds(
  userIds: number[],
  year: number
): Promise<ScoroTask[]> {
  return fetchTasksForUserIds(userIds, year);
}

/**
 * Offer-preparation activity tasks modified in KPI year. Cached once per sync run.
 * Needed because Scoro often omits assignee-owned pitch tasks from doer_id/user_id filters.
 */
async function loadPitchCandidateTasks(year: number): Promise<ScoroTask[]> {
  if (_pitchCandidateTasks && _pitchCandidateTasksYear === year) return _pitchCandidateTasks;

  const { from, to } = yearRange(year);
  _pitchCandidateTasks = await scoroListAllPages<ScoroTask>("tasks/list", {
    filter: {
      activity_type: "Offer preparation",
      modified_date: { from_date: from, to_date: to },
    },
    detailed: true,
    maxPages: 40,
  });
  _pitchCandidateTasksYear = year;
  console.log(
    `[pitch] Loaded ${_pitchCandidateTasks.length} offer-prep activity tasks for ${year}`
  );
  return _pitchCandidateTasks;
}

function taskAssigneeUserIds(t: ScoroTask): number[] {
  const ids: number[] = [];
  const add = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  };
  const addMany = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const a of arr) {
      if (typeof a === "number") add(a);
      else if (typeof a === "object" && a) {
        add((a as { user_id?: unknown }).user_id ?? (a as { id?: unknown }).id);
      }
    }
  };

  addMany(t.assignees ?? t.doers ?? t.related_users);
  add(t.responsible_user_id ?? t.user_id);
  add(t.owner_id);
  add(t.assigned_to);
  return ids;
}

/** True when a team roster member owns, is assigned to, or appears on the task users list. */
export function taskIsLinkedToTeamUser(t: ScoroTask, teamUserIds: Set<number> | number[]): boolean {
  const team = teamUserIds instanceof Set ? teamUserIds : new Set(teamUserIds);
  for (const id of taskAssigneeUserIds(t)) {
    if (team.has(id)) return true;
  }
  return false;
}

function buildPitchTaskPool(
  userTasks: ScoroTask[],
  pitchCandidates: ScoroTask[],
  teamUserIds: number[]
): ScoroTask[] {
  const teamSet = new Set(teamUserIds);
  const seen = new Set<number>();
  const pool: ScoroTask[] = [];

  const remember = (t: ScoroTask) => {
    const id = stableTaskEventId(t);
    if (id != null && seen.has(id)) return;
    if (id != null) seen.add(id);
    pool.push(t);
  };

  for (const t of userTasks) remember(t);
  for (const t of pitchCandidates) {
    if (taskIsLinkedToTeamUser(t, teamSet)) remember(t);
  }
  return pool;
}

// ── Pitch task record ────────────────────────────────────────────────────────

export type PitchTaskRecord = {
  taskId: number | undefined;
  weight: 1 | 2 | 3;
  completed: boolean;
  /** Completed pitch still on an offer-prep project = lost; on any other project = won. */
  won: boolean;
  isNewBusiness: boolean;
  quarter: Quarter | null;
};

export type TeamTaskResults = {
  pitchTasks: PitchTaskRecord[];
};

/**
 * Fetch tasks for team members and extract pitch records.
 * Escalation resolution is org-wide now — see resolveEscalationsForOrg.
 */
export async function fetchTeamTasks(
  team: ResolvedTeam,
  userIds: number[],
  year: number
): Promise<TeamTaskResults> {
  if (userIds.length === 0) return { pitchTasks: [] };

  const teamSet = new Set(userIds);
  const offerPrepIds = await loadOfferPrepProjectIds();
  const userTasks = await fetchTasksForTeamUserIds(userIds, year);
  const pitchCandidates = await loadPitchCandidateTasks(year);
  const pitchPool = buildPitchTaskPool(userTasks, pitchCandidates, userIds);

  const pitchTasks: PitchTaskRecord[] = [];
  let diagLogged = false;

  const seenPitch = new Set<number>();
  for (const t of pitchPool) {
    if (!taskIsLinkedToTeamUser(t, teamSet)) continue;

    const taskId = stableTaskEventId(t);
    if (taskId != null && seenPitch.has(taskId)) continue;

    const tagValue = getTaskTagValue(t);
    const weight = pitchWeightFromTag(tagValue);
    if (weight === null) continue;

    const pid = taskProjectId(t);
    const completed = isTaskCompleted(t);
    const onOfferPrep = pid !== null && offerPrepIds.has(pid);

    if (!diagLogged) {
      console.log(
        `[pitch:diag] sample pitch task — tag: "${tagValue}", businessArea: "${getTaskBusinessArea(t)}", budgetType: "${getTaskBudgetType(t)}", status: "${t.status}/${(t as { status_name?: string }).status_name ?? ""}", project_id: ${pid}, event_id: ${taskId ?? ""}`
      );
      diagLogged = true;
    }

    const q = quarterFromIsoDate(taskDateIso(t), year);
    if (q === null) continue;

    if (taskId != null) seenPitch.add(taskId);
    pitchTasks.push({
      taskId: taskId ?? undefined,
      weight,
      completed,
      won: completed && !onOfferPrep,
      isNewBusiness: isNewBusinessPitchTask(t),
      quarter: q,
    });
  }

  if (pitchTasks.length > 0) {
    console.log(
      `[pitch] ${team.code}: found ${pitchTasks.length} pitch tasks (${pitchTasks.filter((p) => p.completed).length} completed)`
    );
  }

  return { pitchTasks };
}

// ── Org-wide escalation resolution ──────────────────────────────────────────
//
// An escalation-tagged task is attributed to exactly one of the 9 dashboard
// directors, never to a team:
//   1. If a director is among the task's assignees, it goes to them.
//   2. Else if the task has exactly one assignee, it goes to whichever
//      director that assignee's team ultimately reports to (via the same
//      team_leader_lookup chain that already drives teamsForDirector).
//   3. Otherwise (multiple assignees with no director among them, or a team
//      that doesn't resolve to any of the 9 — e.g. the PM-1/2/4/BM/PM-OTHER
//      sub-teams, which report to non-director managers) — no action, the
//      escalation is dropped.

function resolveEscalationTarget(
  assigneeCount: number,
  assigneeEmails: string[],
  directorByEmail: Map<string, DirectorSeed>,
  emailToTeam: Map<string, string>,
  teamToDirector: Map<string, DirectorSeed>
): { director: DirectorSeed; rule: EscalationRule; assigneeTeamCode?: string } | null {
  const directorHit = assigneeEmails.find((e) => directorByEmail.has(e));
  if (directorHit) {
    return { director: directorByEmail.get(directorHit)!, rule: "direct-assignee" };
  }
  if (assigneeCount === 1) {
    const email = assigneeEmails[0];
    const team = email ? emailToTeam.get(email) : undefined;
    const director = team ? teamToDirector.get(team) : undefined;
    if (director) return { director, rule: "team-inherited", assigneeTeamCode: team };
  }
  return null;
}

/**
 * Finds every escalation-tagged task across the whole org in one pass and
 * resolves each to a target director. Reuses the same `users` list already
 * loaded once per sync run — no separate user fetch.
 */
export async function resolveEscalationsForOrg(
  users: ScoroUser[],
  year: number
): Promise<Map<string, MockEscalation[]>> {
  const out = new Map<string, MockEscalation[]>();
  if (users.length === 0) return out;

  const userIdToEmail = new Map<number, string>();
  for (const u of users) userIdToEmail.set(u.id, u.email.toLowerCase());

  const directorByEmail = new Map<string, DirectorSeed>();
  for (const d of DIRECTOR_SEEDS) directorByEmail.set(d.email.toLowerCase(), d);

  const teamToDirector = new Map<string, DirectorSeed>();
  for (const d of DIRECTOR_SEEDS) {
    for (const code of teamsForDirector(d.email)) teamToDirector.set(code, d);
  }

  // Not filtered by special_rules.excluded_people — exclusion is about
  // roster/capacity display, not escalation routing.
  const emailToTeam = new Map<string, string>();
  for (const m of MAPPING.members) emailToTeam.set(m.email.toLowerCase(), m.team);

  // One paginated org-wide fetch, filtered only by date (same pattern as
  // loadPitchCandidateTasks) — NOT fetchTasksForUserIds, which loops per
  // user per filter key and is only cheap at single-team scale (5-20
  // people); at 198 org users it multiplies into hundreds of sequential,
  // heavily rate-limited calls.
  const { from, to } = yearRange(year);
  const tasks = await scoroListAllPages<ScoroTask>("tasks/list", {
    filter: { modified_date: { from_date: from, to_date: to } },
    detailed: true,
    maxPages: 400,
  });

  const seen = new Set<number>();
  let fallbackIdx = 0;

  for (const t of tasks) {
    const taskId = stableTaskEventId(t);
    if (taskId != null && seen.has(taskId)) continue;
    if (taskId != null) seen.add(taskId);

    if (!/escalation/i.test(getTaskTagValue(t))) continue;

    const d =
      (typeof t.modified_date === "string" && String(t.modified_date).slice(0, 10)) ||
      taskDateIso(t) ||
      "";
    if (d < from || d > to) continue;

    const assigneeIds = taskAssigneeUserIds(t);
    const assigneeEmails = assigneeIds
      .map((id) => userIdToEmail.get(id))
      .filter((e): e is string => !!e);

    const target = resolveEscalationTarget(
      assigneeIds.length,
      assigneeEmails,
      directorByEmail,
      emailToTeam,
      teamToDirector
    );
    if (!target) continue;

    const q = quarterFromIsoDate(d, year) ?? "Q1";
    const escalation: MockEscalation = {
      id: taskId != null ? `esc-task-${year}-${taskId}` : `esc-task-${year}-${fallbackIdx++}`,
      teamCode: target.assigneeTeamCode ?? "Direct",
      teamName: target.assigneeTeamCode ?? "Direct to director",
      projectId: taskProjectId(t) ?? undefined,
      project: String(t.event_name ?? t.name ?? t.description ?? "Task"),
      score: 0,
      quarter: q,
      opened: d,
      severity: "medium",
      reason: "Tagged as Escalation in Scoro.",
      directorEmail: target.director.email,
      directorId: target.director.id,
      rule: target.rule,
    };

    const list = out.get(target.director.email) ?? [];
    list.push(escalation);
    out.set(target.director.email, list);
  }

  return out;
}

export function leadUserIdForTeam(
  team: ResolvedTeam,
  users: ScoroUser[]
): number | null {
  if (!team.leadEmail) return null;
  const email = team.leadEmail.toLowerCase();
  const match = users.find((u) => u.email.toLowerCase() === email);
  return match?.id ?? null;
}

const PROJECTS_BY_ID_CHUNK_SIZE = 100;

/** Fetch projects by id in chunks (one paginated call per ~100 ids), not
 * one call per id — a single team's lead-project lookup can involve
 * hundreds of ids, and Scoro's `project_id` filter accepts an array. */
async function fetchProjectsByIds(
  ids: number[],
  known: Map<number, ScoroProject>
): Promise<ScoroProject[]> {
  const out = new Map<number, ScoroProject>();
  for (const id of ids) {
    const cached = known.get(id);
    if (cached) out.set(id, cached);
  }

  const missing = ids.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += PROJECTS_BY_ID_CHUNK_SIZE) {
    const chunk = missing.slice(i, i + PROJECTS_BY_ID_CHUNK_SIZE);
    const rows = await scoroListAllPages<ScoroProject>("projects/list", {
      filter: { project_id: chunk },
      detailed: true,
      maxPages: Math.ceil(chunk.length / 25) + 1,
    });
    for (const p of rows) {
      const pid = projectNumericId(p);
      if (Number.isFinite(pid) && pid > 0) out.set(pid, p);
    }
  }

  return [...out.values()];
}

export type ActiveProjectsResult = {
  projects: ScoroProject[];
  details: ActiveProjectDetail[];
};

/**
 * Completed/invoiced client projects where the design lead had at least one task.
 * Used for FTA and Projects in Estimate (Rafal: same attribution as active projects).
 */
export async function fetchLeadKpiProjectsForTeam(
  team: ResolvedTeam,
  users: ScoroUser[],
  knownProjects: ScoroProject[] = [],
  year: number
): Promise<ScoroProject[]> {
  const leadId = leadUserIdForTeam(team, users);
  if (leadId == null) {
    console.warn(`[kpi:lead] ${team.code}: no Scoro user for design lead ${team.leadEmail ?? "?"}`);
    return [];
  }

  const leadTasks = await fetchAllTasksForLead(leadId, year);
  const projectIds = new Set<number>();
  for (const t of leadTasks) {
    const pid = taskProjectId(t);
    if (pid != null) projectIds.add(pid);
  }

  if (projectIds.size === 0) return [];

  const known = new Map<number, ScoroProject>();
  for (const p of knownProjects) {
    const pid = projectNumericId(p);
    if (Number.isFinite(pid) && pid > 0) known.set(pid, p);
  }

  const projects = await fetchProjectsByIds([...projectIds], known);
  const kpiProjects = projects.filter((p) => isClientProject(p) && isCompletedOrInvoiced(p));
  console.log(
    `[kpi:lead] ${team.code}: ${leadTasks.length} lead tasks → ${projectIds.size} projects → ${kpiProjects.length} completed/invoiced for FTA/estimate`
  );
  return kpiProjects;
}

/**
 * Active projects for a team: non-terminal client projects (excl. Admind Project / Growth / Barter / Business Development)
 * where the design lead has at least one open (non-completed) assigned task
 * that is not on an Internal activities (non billable) activity type.
 */
export async function fetchActiveProjectsForTeam(
  team: ResolvedTeam,
  users: ScoroUser[],
  knownProjects: ScoroProject[] = []
): Promise<ActiveProjectsResult> {
  const leadId = leadUserIdForTeam(team, users);
  if (leadId == null) {
    console.warn(`[active] ${team.code}: no Scoro user for design lead ${team.leadEmail ?? "?"}`);
    return { projects: [], details: [] };
  }

  const openTasksRaw = await fetchOpenTasksForLead(leadId);
  const openTasks = await filterTasksForActiveProjects(openTasksRaw);
  const projectIds = new Set<number>();
  for (const t of openTasks) {
    const pid = taskProjectId(t);
    if (pid != null) projectIds.add(pid);
  }

  if (projectIds.size === 0) {
    console.log(
      `[active] ${team.code}: design lead has no qualifying open project-linked tasks (${openTasksRaw.length} raw open → ${openTasks.length} after internal-activity filter)`
    );
    return { projects: [], details: [] };
  }

  const known = new Map<number, ScoroProject>();
  for (const p of knownProjects) {
    const pid = projectNumericId(p);
    if (Number.isFinite(pid) && pid > 0) known.set(pid, p);
  }

  const projects = await fetchProjectsByIds([...projectIds], known);
  const active = projects.filter(
    (p) => !isTerminalProject(p) && !isExcludedActiveProjectBudget(p)
  );
  const details = buildActiveProjectDetails(active, openTasks);

  console.log(
    `[active] ${team.code}: ${openTasksRaw.length} raw open → ${openTasks.length} after filters → ${projectIds.size} projects → ${active.length} active`
  );
  return { projects: active, details };
}

/**
 * Compute weighted pitch win rates from task records.
 * Denominator: completed pitch tasks (by Business area).
 * Numerator: completed pitches won — still on offer-prep project = lost.
 */
export function computePitchKpisFromTasks(
  pitchTasks: PitchTaskRecord[],
  year: number
): {
  newBizWin: Record<Quarter, number>;
  existingWin: Record<Quarter, number>;
  analyzed: { newBizWin: number; existingWin: number };
  debug: {
    newBizWin: Record<Quarter, KpiQuarterDebug>;
    existingWin: Record<Quarter, KpiQuarterDebug>;
  };
} {
  const zeros = () =>
    Object.fromEntries(QUARTERS.map((q) => [q, 0])) as Record<Quarter, number>;
  const zeroCounts = (): Record<Quarter, KpiQuarterDebug> =>
    Object.fromEntries(QUARTERS.map((q) => [q, { numerator: 0, denominator: 0, poolSize: 0 }])) as Record<
      Quarter,
      KpiQuarterDebug
    >;

  const newBizWin = zeros();
  const existingWin = zeros();
  const analyzed = { newBizWin: 0, existingWin: 0 };
  const debug = { newBizWin: zeroCounts(), existingWin: zeroCounts() };

  for (const q of QUARTERS) {
    const inQuarter = pitchTasks.filter((t) => t.quarter === q);

    // New Business — denominator = completed only
    const nbCompleted = inQuarter.filter((t) => t.isNewBusiness && t.completed);
    const nbWon = nbCompleted.filter((t) => t.won);
    const nbWeightAll = nbCompleted.reduce((s, t) => s + t.weight, 0);
    const nbWeightWon = nbWon.reduce((s, t) => s + t.weight, 0);
    newBizWin[q] = nbWeightAll > 0 ? Math.round((100 * nbWeightWon) / nbWeightAll) : 0;
    debug.newBizWin[q] = { numerator: nbWeightWon, denominator: nbWeightAll, poolSize: nbCompleted.length };
    analyzed.newBizWin += nbCompleted.length;

    // Existing Client — denominator = completed only
    const exCompleted = inQuarter.filter((t) => !t.isNewBusiness && t.completed);
    const exWon = exCompleted.filter((t) => t.won);
    const exWeightAll = exCompleted.reduce((s, t) => s + t.weight, 0);
    const exWeightWon = exWon.reduce((s, t) => s + t.weight, 0);
    existingWin[q] = exWeightAll > 0 ? Math.round((100 * exWeightWon) / exWeightAll) : 0;
    debug.existingWin[q] = { numerator: exWeightWon, denominator: exWeightAll, poolSize: exCompleted.length };
    analyzed.existingWin += exCompleted.length;
  }

  return { newBizWin, existingWin, analyzed, debug };
}

export function clearLiveCaches(): void {
  activityCache = null;
  _budgetCache = null;
  _offerPrepBookmarkId = undefined;
  _offerPrepIds = null;
  _pitchCandidateTasks = null;
  _pitchCandidateTasksYear = null;
  _orgTimeOffs = null;
  _orgTimeOffsYear = null;
  clearScoroActivityCaches();
}

/**
 * When `projectsForKpis` is set, use it as the project list (exclusive per director for KPIs).
 * `projectsForActiveCount` should be design-lead open-task projects (see fetchActiveProjectsForTeam).
 * `activeProjectDetails` is the reconcilable project list for the dashboard agent.
 * When omitted, fetch and filter for this team only (legacy / retry path).
 * Escalation resolution is org-wide, not per-team — see resolveEscalationsForOrg.
 */
export async function loadTeamBundleFromScoro(
  team: ResolvedTeam,
  userIds: number[],
  year: number,
  users: ScoroUser[],
  projectsForKpis?: ScoroProject[],
  projectsForUtilization?: ScoroProject[],
  projectsForActiveCount?: ScoroProject[],
  activeProjectDetails?: ActiveProjectDetail[],
  previousDebug?: PreviousUtilBillableDebug
): Promise<TeamStats> {
  if (userIds.length === 0) {
    throw new Error("no_scoro_users");
  }

  let projects: ScoroProject[];
  if (projectsForKpis !== undefined) {
    projects = projectsForKpis;
  } else {
    projects = await fetchProjectsForTeamUserIds(userIds).then((fetched) =>
      filterProjectsToTeamParticipants(fetched, userIds)
    );
  }

  const agg = await aggregateTimeForTeam(
    team,
    userIds,
    year,
    users,
    projectsForUtilization ?? projects,
    previousDebug
  );
  const projKpi = computeProjectKpisByQuarter(projects, year);

  const { pitchTasks } = await fetchTeamTasks(team, userIds, year);
  const pitchKpi = computePitchKpisFromTasks(pitchTasks, year);

  const kpis = {} as TeamStats["kpis"];
  for (const m of KPI_META) {
    kpis[m.key] = Object.fromEntries(PERIODS.map((p) => [p, 0])) as Record<string, number>;
  }

  const zeroDebug = () =>
    Object.fromEntries(PERIODS.map((p) => [p, { numerator: 0, denominator: 0 }])) as Record<
      string,
      KpiQuarterDebug
    >;
  const kpiDebug: KpiDebug = {
    utilization: zeroDebug(),
    billable:    zeroDebug(),
    fta:         { ...projKpi.debug.fta },
    estimate:    { ...projKpi.debug.estimate },
    newBizWin:   { ...pitchKpi.debug.newBizWin },
    existingWin: { ...pitchKpi.debug.existingWin },
  };

  for (const q of QUARTERS) {
    const { billableSec, utilizationSec, targetSec } = agg[q];
    // Both utilization and billable are ÷ target hours (real per-weekday
    // schedule minus booked time off) — not ÷ logged hours.
    const util =
      targetSec > 0 ? Math.min(100, Math.round((100 * utilizationSec) / targetSec)) : 0;
    const bill =
      targetSec > 0 ? Math.min(100, Math.round((100 * billableSec) / targetSec)) : 0;
    (kpis.utilization as Record<string, number>)[q] = util;
    (kpis.billable as Record<string, number>)[q] = bill;
    (kpis.fta as Record<string, number>)[q] = projKpi.fta[q];
    (kpis.estimate as Record<string, number>)[q] = projKpi.estimate[q];
    (kpis.newBizWin as Record<string, number>)[q] = pitchKpi.newBizWin[q];
    (kpis.existingWin as Record<string, number>)[q] = pitchKpi.existingWin[q];

    kpiDebug.utilization[q] = { numerator: utilizationSec, denominator: targetSec };
    kpiDebug.billable[q]    = { numerator: billableSec,    denominator: targetSec };
  }

  // YTD = sum of each KPI's raw numerator/denominator across Q1..Q4, then one
  // divide — never an average of the four quarterly percentages. Since time
  // entries and project-completion dates are already bucketed strictly by
  // calendar quarter using only past-or-today data, Q1+Q2+Q3+partial-Q4 IS
  // year-to-date; no separate Scoro fetch is needed for this.
  for (const m of KPI_META) {
    const debugByQ = kpiDebug[m.key];
    const numerator = QUARTERS.reduce((s, q) => s + debugByQ[q].numerator, 0);
    const denominator = QUARTERS.reduce((s, q) => s + debugByQ[q].denominator, 0);
    debugByQ.YTD = { numerator, denominator };
    (kpis[m.key] as Record<string, number>).YTD =
      denominator > 0 ? Math.min(100, Math.round((100 * numerator) / denominator)) : 0;
  }

  const activeList =
    projectsForActiveCount ??
    (projectsForKpis !== undefined ? projectsForUtilization : undefined) ??
    projects;

  return {
    kpis,
    activeProjects: activeProjectCount(activeList),
    activeProjectDetails:
      activeProjectDetails ??
      (projectsForActiveCount !== undefined ? [] : undefined),
    projectsAnalyzed: {
      fta: projKpi.analyzed.fta,
      estimate: projKpi.analyzed.estimate,
      newBizWin: pitchKpi.analyzed.newBizWin,
      existingWin: pitchKpi.analyzed.existingWin,
    },
    kpiDebug,
  };
}
