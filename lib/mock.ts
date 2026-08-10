import { KPI_META, PERIODS, type KpiKey } from "./brand";
import type { ResolvedDirector, ResolvedTeam } from "./directors";

const ZERO_QUARTERS = Object.fromEntries(PERIODS.map((p) => [p, 0])) as Record<
  string,
  number
>;

export type TeamKpis = Record<KpiKey, Record<string, number>>;

/**
 * Raw inputs behind each KPI percentage — stored alongside the final number so
 * the AI agent can explain "76% = 2,834 h worked on client projects ÷ 3,724 h capacity".
 *
 * utilization / billable: numerator/denominator both in seconds. Denominator
 *   for both is target hours — each member's real per-weekday Scoro schedule
 *   minus booked time off — NOT total logged hours.
 * all others: integer project counts
 */
export type KpiQuarterDebug = {
  numerator: number;
  denominator: number;
  /** Pitch KPIs: number of eligible tasks in this quarter (denominator is weighted). */
  poolSize?: number;
};

export type KpiDebug = Record<KpiKey, Record<string, KpiQuarterDebug>>;

/** One row in the active-projects list shown to the dashboard agent. */
export type ActiveProjectDetail = {
  projectId: number;
  name: string;
  status: string;
  budgetType: string;
  openTaskCount: number;
};

export type TeamStats = {
  kpis: TeamKpis;
  activeProjects: number;
  /** Non-terminal client projects where the design lead has open tasks (for agent reconciliation). */
  activeProjectDetails?: ActiveProjectDetail[];
  projectsAnalyzed: {
    fta: number;
    estimate: number;
    newBizWin: number;
    existingWin: number;
  };
  /** Optional: raw numerator / denominator per KPI per quarter for agent explanations. */
  kpiDebug?: KpiDebug;
};

/** Placeholder KPI grid: every quarter is 0% until Scoro wiring is enabled. */
export function mockTeamStats(_director: ResolvedDirector, _team: ResolvedTeam): TeamStats {
  const kpis = Object.fromEntries(
    KPI_META.map((m) => [m.key, { ...ZERO_QUARTERS }])
  ) as TeamKpis;

  return {
    kpis,
    activeProjects: 0,
    activeProjectDetails: [],
    projectsAnalyzed: { fta: 0, estimate: 0, newBizWin: 0, existingWin: 0 },
  };
}

/**
 * How an escalation was attributed to its director: directly (they're a task
 * assignee) or by walking the assignee's team up to the director it reports to.
 */
export type EscalationRule = "direct-assignee" | "team-inherited";

export type MockEscalation = {
  id: string;
  /** Assignee's team for team-inherited hits; a synthetic label for direct-assignee hits. */
  teamCode: string;
  teamName: string;
  project: string;
  /** Scoro project id — used to dedupe escalations across duplicate project fetches */
  projectId?: number;
  score: number;
  quarter: string;
  opened: string;
  severity: "low" | "medium" | "high";
  reason: string;
  /** Resolved target director (see EscalationRule). */
  directorEmail: string;
  directorId: string;
  rule: EscalationRule;
};

/** No escalation rows while KPI data is hardcoded. */
export function mockEscalations(_director: ResolvedDirector): MockEscalation[] {
  return [];
}
