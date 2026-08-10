/** Yearly major-escalation cap per director (see Agentic dashboard metrics.md). */
export const ESCALATION_YEARLY_MAX = 2;

export const COLORS = {
  ink: "#0A0A0A",
  inkSoft: "#3A3A3A",
  muted: "#5A5A5A",
  hairline: "#1A1A1A",
  paper: "#FFFFFF",
  subtleBg: "#F6F4EF",
  beige: "#EBDBC3",
  peach: "#F1D8BF",
  tangerine: "#FF5A3C",
  turquoise: "#00DDC2",
  gray01: "#D9D9D9",
  gray02: "#5A5A5A",
  gray03: "#B0B0B0",
  onTrack: "#8A8A8A",
} as const;

/** Where dashboard metrics came from (avoid importing server `kpi` in client UI). */
export type DataSource = "scoro" | "fallback";

export type KpiKey =
  | "utilization"
  | "billable"
  | "fta"
  | "estimate"
  | "newBizWin"
  | "existingWin";

export type KpiKind = "donut" | "bar";

export type KpiMeta = {
  key: KpiKey;
  label: string;
  shortLabel?: string;
  goal: number;
  kind: KpiKind;
  note: string;
};

export const KPI_META: KpiMeta[] = [
  {
    key: "utilization",
    label: "Project utilization",
    goal: 75,
    kind: "donut",
    note: "Total logged hours on client projects and Scrum, divided by target hours from the team.",
  },
  {
    key: "billable",
    label: "Billable hours",
    goal: 65,
    kind: "bar",
    note: "Total hours billed to the client, divided by target hours from the team.",
  },
  {
    key: "fta",
    label: "First-Time Acceptance Rate",
    shortLabel: "FTA rate",
    goal: 15,
    kind: "bar",
    note: "Share of projects with the \u201cFTA\u201d tag where deliverables were accepted within 2 feedback rounds and within budget, or where the creative direction was selected and approved from the 1st proposal, divided by all team projects.",
  },
  {
    key: "estimate",
    label: "Projects in Estimate",
    goal: 80,
    kind: "bar",
    note: "Number of projects completed within the initial budget estimate, divided by all completed projects by the team.",
  },
  {
    key: "newBizWin",
    label: "New Business Pitch Win Rate",
    shortLabel: "New biz win",
    goal: 30,
    kind: "bar",
    note: "Weighted ratio of tasks tagged Pitch (by tier) with Business Area = New Business that are Completed, vs all such pitch tasks. Weights: <10k\u202fPLN\u2009=\u20091, 10\u201350k\u2009=\u20092, >50k\u2009=\u20093. Tasks linked to the All Offer Prep projects bookmark are excluded.",
  },
  {
    key: "existingWin",
    label: "Existing Client Pitch Win Rate",
    shortLabel: "Existing win",
    goal: 60,
    kind: "bar",
    note: "Weighted ratio of tasks tagged Pitch (by tier) with Business Area \u2260 New Business that are Completed, vs all such pitch tasks. Weights: <10k\u202fPLN\u2009=\u20091, 10\u201350k\u2009=\u20092, >50k\u2009=\u20093. Tasks linked to the All Offer Prep projects bookmark are excluded.",
  },
];

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
export type Quarter = (typeof QUARTERS)[number];

/** Quarters plus year-to-date — used for period *selection/display* only; date-bucketing
 * logic (quarterFromIsoDate, quarterRange, etc.) must keep using Quarter/QUARTERS. */
export const PERIODS = [...QUARTERS, "YTD"] as const;
export type Period = (typeof PERIODS)[number];

export type KpiStatus = "achieved" | "onTrack" | "off";

export function statusOf(value: number, goal: number): KpiStatus {
  if (value >= goal) return "achieved";
  if (value >= goal * 0.75) return "onTrack";
  return "off";
}

export function statusColor(s: KpiStatus): string {
  if (s === "achieved") return COLORS.turquoise;
  if (s === "onTrack") return COLORS.onTrack;
  return COLORS.tangerine;
}
