import "server-only";

import type { ResolvedTeam, WeekAvailability } from "./directors";
import { MAPPING, membersForTeam, type TeamCode } from "./mapping";
import { scoroListAllPages } from "./scoro-api";

export type ScoroUserDetailed = {
  id: number;
  email: string;
  name: string;
  groupIds: number[];
  isActive: boolean;
  /** Present when Scoro returns a populated availability record for this user. */
  availability?: WeekAvailability;
};

type ScoroUserAvailabilityRow = {
  monday?: number;
  tuesday?: number;
  wednesday?: number;
  thursday?: number;
  friday?: number;
  saturday?: number;
  sunday?: number;
};

type ScoroUserRow = {
  id?: number;
  email?: string;
  full_name?: string;
  firstname?: string;
  lastname?: string;
  is_active?: number | string;
  status?: string;
  user_groups_ids?: Array<string | number>;
  availability?: ScoroUserAvailabilityRow;
};

function parseAvailability(raw: ScoroUserAvailabilityRow | undefined): WeekAvailability | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    monday: n(raw.monday),
    tuesday: n(raw.tuesday),
    wednesday: n(raw.wednesday),
    thursday: n(raw.thursday),
    friday: n(raw.friday),
    saturday: n(raw.saturday),
    sunday: n(raw.sunday),
  };
}

type ScoroGroupRow = {
  group_id?: number;
  group_name?: string;
};

/** Teams without a 1:1 Scoro user group — keep JSON roster (PM sub-teams, etc.). */
const JSON_ROSTER_TEAMS = new Set<TeamCode>([
  "COPYWRITER",
  "FURTI",
  "PM-1",
  "PM-2",
  "PM-4",
  "PM-OTHER",
  "PM-PPT",
  "PM-BM",
  "PM-DP",
]);

/** Dashboard team code → Scoro `userGroups/list` group_name. */
const TEAM_GROUP_NAME_OVERRIDES: Record<string, string> = {
  ACC: "Team #Accelleron",
  BA: "Team #Other_BA",
  CAMPAIGNS: "Team #Campaigns",
  CD: "Team #CDs",
  COE: "Team #COE",
  CT: "Creative Technology",
  "DP & BP": "Digital Platforms",
  "MO - MAJA": "Team #Motion",
  "MO - MO": "Team #Motion",
  PRINC: "Team #Principles",
  STR: "Team #Therefore Strategy",
  "UBS-SYN": "Team #Design Rescue",
  UBS_BA: "Team #ABB_BA",
};

const EXCLUDED_EMAILS = new Set(
  MAPPING.special_rules.excluded_people.map((e) => e.toLowerCase())
);

export function scoroGroupNameForTeam(code: TeamCode): string | null {
  if (JSON_ROSTER_TEAMS.has(code)) return null;
  return TEAM_GROUP_NAME_OVERRIDES[code] ?? `Team #${code}`;
}

function parseGroupIds(raw: ScoroUserRow["user_groups_ids"]): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function userDisplayName(row: ScoroUserRow): string {
  if (typeof row.full_name === "string" && row.full_name.trim()) return row.full_name.trim();
  const parts = [row.firstname, row.lastname].filter((p) => typeof p === "string" && p.trim());
  if (parts.length) return parts.join(" ").trim();
  return String(row.email ?? "Unknown");
}

function userIsActive(row: ScoroUserRow): boolean {
  if (row.is_active === 0 || row.is_active === "0") return false;
  const status = String(row.status ?? "").toLowerCase();
  if (status === "inactive" || status === "awaiting") return false;
  return true;
}

export async function loadScoroUsersDetailed(): Promise<ScoroUserDetailed[]> {
  const rows = await scoroListAllPages<ScoroUserRow>("users/list", { detailed: true });
  return rows
    .filter((r) => typeof r.id === "number" && typeof r.email === "string")
    .map((r) => ({
      id: r.id as number,
      email: (r.email as string).toLowerCase(),
      name: userDisplayName(r),
      groupIds: parseGroupIds(r.user_groups_ids),
      isActive: userIsActive(r),
      availability: parseAvailability(r.availability),
    }));
}

export async function loadScoroUserGroupIdsByName(): Promise<Map<string, number>> {
  const rows = await scoroListAllPages<ScoroGroupRow>("userGroups/list", {});
  const out = new Map<string, number>();
  for (const row of rows) {
    const id = row.group_id;
    const name = row.group_name;
    if (typeof id === "number" && typeof name === "string" && name.trim()) {
      out.set(name.trim(), id);
    }
  }
  return out;
}

export function weeklyTargetForEmail(email: string): number {
  const target = MAPPING.members.find(
    (m) => m.email.toLowerCase() === email.toLowerCase()
  )?.weekly_target;
  return typeof target === "number" && target > 0 ? target : 40;
}

function membersFromJson(teamCode: TeamCode): ResolvedTeam["members"] {
  return membersForTeam(teamCode).map((m) => ({
    name: m.name,
    email: m.email,
    weeklyTarget: m.weekly_target,
  }));
}

/** Resolve live roster from Scoro user groups; falls back to mapping JSON when needed. */
export function resolveTeamRosterFromScoro(
  teamCode: TeamCode,
  users: ScoroUserDetailed[],
  groupIdsByName: Map<string, number>
): { members: ResolvedTeam["members"]; source: "scoro" | "json" } {
  const groupName = scoroGroupNameForTeam(teamCode);
  if (!groupName) {
    return { members: membersFromJson(teamCode), source: "json" };
  }

  const groupId = groupIdsByName.get(groupName);
  if (groupId == null) {
    console.warn(
      `[roster] ${teamCode}: Scoro group "${groupName}" not found — using mapping JSON`
    );
    return { members: membersFromJson(teamCode), source: "json" };
  }

  const members = users
    .filter(
      (u) =>
        u.isActive &&
        !EXCLUDED_EMAILS.has(u.email) &&
        u.groupIds.includes(groupId)
    )
    .map((u) => ({
      name: u.name,
      email: u.email,
      weeklyTarget: weeklyTargetForEmail(u.email),
      availability: u.availability,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(
    `[roster] ${teamCode}: ${members.length} active member(s) from Scoro "${groupName}"`
  );
  return { members, source: "scoro" };
}

export function withScoroRoster(
  team: ResolvedTeam,
  members: ResolvedTeam["members"]
): ResolvedTeam {
  return {
    ...team,
    members,
    people: members.length,
  };
}
