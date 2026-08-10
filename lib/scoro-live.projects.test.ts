import { describe, expect, it } from "vitest";
import { isFtaLiveForTeam, isFtaMutedForTeam, normalizeTeamCode } from "./fta-display";
import {
  activeProjectCount,
  assignProjectsExclusiveToTeams,
  buildActiveProjectDetails,
  filterProjectsToTeamParticipants,
  findProjectBookmarkByTitle,
  isExcludedActiveProjectBudget,
  isTerminalProject,
  normalizeBookmarkTitle,
  type TeamProjectFetch,
} from "./scoro-live";
import type { ResolvedTeam } from "./directors";

function team(code: string, userIds: number[]): TeamProjectFetch {
  const t: ResolvedTeam = {
    code: code as ResolvedTeam["code"],
    name: `Team ${code}`,
    leadEmail: undefined,
    leadName: undefined,
    people: userIds.length,
    members: [],
  };
  return { team: t, userIds, projects: [] };
}

function project(
  id: number,
  opts: { bookmarkUsers?: number[]; status?: string; managerId?: number } = {}
): Record<string, unknown> {
  return {
    project_id: id,
    project_name: `Project ${id}`,
    status: opts.status ?? "in progress",
    bookmark_users: opts.bookmarkUsers ?? [],
    manager_id: opts.managerId,
  };
}

describe("normalizeTeamCode", () => {
  it("maps zero-padded numeric codes", () => {
    expect(normalizeTeamCode("01")).toBe("1");
    expect(normalizeTeamCode("04")).toBe("4");
  });
});

describe("FTA display", () => {
  it("enables full color for all teams when allowlist is empty", () => {
    expect(isFtaLiveForTeam("1", [])).toBe(true);
    expect(isFtaMutedForTeam("4", [])).toBe(false);
  });

  it("respects allowlist with normalized codes", () => {
    expect(isFtaLiveForTeam("1", ["01", "2"])).toBe(true);
    expect(isFtaMutedForTeam("4", ["01", "2"])).toBe(true);
  });
});

describe("filterProjectsToTeamParticipants", () => {
  it("drops bookmark-fetched rows with no team-linked users", () => {
    const rows = [project(99, { bookmarkUsers: [] })];
    expect(filterProjectsToTeamParticipants(rows, [10, 11])).toEqual([]);
  });

  it("keeps rows when a bookmark user is on the roster", () => {
    const rows = [project(1, { bookmarkUsers: [10] })];
    expect(filterProjectsToTeamParticipants(rows, [10, 11])).toHaveLength(1);
  });
});

describe("assignProjectsExclusiveToTeams vs activeProjectCount", () => {
  it("exclusive assignment shrinks one team but per-team list preserves counts", () => {
    const shared = project(1, { bookmarkUsers: [1, 2], managerId: 1 });
    const team1Only = project(2, { bookmarkUsers: [1], managerId: 1 });
    const team4Only = project(3, { bookmarkUsers: [4], managerId: 4 });

    const bundles: TeamProjectFetch[] = [
      { ...team("1", [1]), projects: [shared, team1Only] },
      { ...team("4", [4]), projects: [shared, team4Only] },
    ];

    const exclusive = assignProjectsExclusiveToTeams(bundles);
    expect(activeProjectCount(bundles[0].projects)).toBe(2);
    expect(activeProjectCount(bundles[1].projects)).toBe(2);
    expect(activeProjectCount(exclusive.get("4") ?? [])).toBe(1);
    expect(activeProjectCount(exclusive.get("4") ?? [])).toBeLessThan(
      activeProjectCount(bundles[1].projects)
    );
  });
});

describe("activeProjectCount", () => {
  it("counts non-terminal projects and excludes Admind Project / Growth / Barter / Business Development", () => {
    const rows = [
      { project_id: 1, status: "in progress", custom_fields: [{ name: "Budget Type", value: "CE" }] },
      { project_id: 2, status: "completed", custom_fields: [{ name: "Budget Type", value: "CE" }] },
      { project_id: 3, status: "on hold", custom_fields: [{ name: "Budget Type", value: "Growth" }] },
      { project_id: 4, status: "in progress", custom_fields: [{ name: "Budget Type", value: "Admind Project" }] },
      { project_id: 5, status: "in progress", custom_fields: [{ name: "Budget Type", value: "Business Development" }] },
    ];
    expect(activeProjectCount(rows)).toBe(1);
    expect(isTerminalProject(rows[1])).toBe(true);
    expect(isExcludedActiveProjectBudget(rows[2])).toBe(true);
  });

  it("uses Scoro status names — pending/in progress is active; empty status is not terminal", () => {
    expect(
      isTerminalProject({ project_id: 1, status: "pending", status_name: "In progress" })
    ).toBe(false);
    expect(
      isTerminalProject({ project_id: 2, status: "completed", status_name: "Invoiced" })
    ).toBe(true);
    expect(isTerminalProject({ project_id: 3 })).toBe(false);
  });
});

describe("buildActiveProjectDetails", () => {
  it("attaches open-task counts per project", () => {
    const projects = [
      { project_id: 10, project_name: "Alpha", status_name: "In progress", custom_fields: [{ name: "Budget Type", value: "CE" }] },
      { project_id: 20, project_name: "Beta", status_name: "In progress", custom_fields: [{ name: "Budget Type", value: "BM" }] },
    ];
    const tasks = [
      { project_id: 10, is_completed: 0 },
      { project_id: 10, is_completed: 0 },
      { project_id: 20, is_completed: 0 },
    ];
    const details = buildActiveProjectDetails(projects, tasks);
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({ projectId: 10, name: "Alpha", openTaskCount: 2, budgetType: "ce" });
    expect(details[1]).toMatchObject({ projectId: 20, openTaskCount: 1 });
  });
});

describe("offer prep bookmark lookup", () => {
  const bookmarks = [
    { bookmark_id: 100, title: "All Offer Prep projects" },
    { bookmark_id: 200, title: "Active pitches" },
  ];

  it("matches bookmark title case-insensitively with extra whitespace", () => {
    expect(normalizeBookmarkTitle("  All   Offer   Prep   projects  ")).toBe(
      "all offer prep projects"
    );
    expect(findProjectBookmarkByTitle(bookmarks, "all offer prep projects")).toEqual(bookmarks[0]);
  });

  it("does not partial-match similar titles", () => {
    expect(findProjectBookmarkByTitle(bookmarks, "Offer prep")).toBeNull();
    expect(findProjectBookmarkByTitle(bookmarks, "All Offer Prep")).toBeNull();
  });

  it("returns null when title is missing", () => {
    expect(findProjectBookmarkByTitle(bookmarks, "Unknown bookmark")).toBeNull();
  });
});
