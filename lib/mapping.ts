import mappingRaw from "@/mapping_ba_update.json";

export type TeamCode = string;

export type MappingMember = {
  name: string;
  email: string;
  team: TeamCode;
  leader_email: string;
  weekly_target: number;
  is_team_lead?: boolean;
};

export type TeamLeaderEntry = {
  leader_email: string;
  upper_leader_email: string;
  report_format?: string;
};

export type MappingFile = {
  description: string;
  special_rules: {
    justyna_dorman?: string;
    excluded_people: string[];
  };
  team_leader_lookup: Record<TeamCode, TeamLeaderEntry>;
  members: MappingMember[];
};

export const MAPPING = mappingRaw as unknown as MappingFile;

const EXCLUDED = new Set(MAPPING.special_rules.excluded_people);

export function teamsForDirector(directorEmail: string): TeamCode[] {
  return Object.entries(MAPPING.team_leader_lookup)
    .filter(
      ([, v]) =>
        v.upper_leader_email === directorEmail ||
        v.leader_email === directorEmail
    )
    .map(([code]) => code);
}

export function membersForTeam(team: TeamCode): MappingMember[] {
  return MAPPING.members.filter(
    (m) => m.team === team && !EXCLUDED.has(m.email)
  );
}

export function leaderOfTeam(team: TeamCode): string | undefined {
  return MAPPING.team_leader_lookup[team]?.leader_email;
}

export function leaderNameOfTeam(team: TeamCode): string | undefined {
  const leaderEmail = leaderOfTeam(team);
  if (!leaderEmail) return undefined;
  const leader = MAPPING.members.find((m) => m.email === leaderEmail);
  return leader?.name;
}
