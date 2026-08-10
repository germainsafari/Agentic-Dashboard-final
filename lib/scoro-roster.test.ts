import { describe, expect, it } from "vitest";
import {
  resolveTeamRosterFromScoro,
  scoroGroupNameForTeam,
  type ScoroUserDetailed,
} from "./scoro-roster";

function user(
  id: number,
  email: string,
  groupIds: number[],
  isActive = true
): ScoroUserDetailed {
  return { id, email, name: email.split("@")[0], groupIds, isActive };
}

describe("scoroGroupNameForTeam", () => {
  it("maps standard codes to Team # prefix", () => {
    expect(scoroGroupNameForTeam("4")).toBe("Team #4");
    expect(scoroGroupNameForTeam("COE")).toBe("Team #COE");
  });

  it("uses overrides for renamed Scoro groups", () => {
    expect(scoroGroupNameForTeam("UBS-SYN")).toBe("Team #Design Rescue");
    expect(scoroGroupNameForTeam("ACC")).toBe("Team #Accelleron");
  });

  it("returns null for PM sub-teams (JSON fallback)", () => {
    expect(scoroGroupNameForTeam("PM-1")).toBeNull();
  });
});

describe("resolveTeamRosterFromScoro", () => {
  const groups = new Map<string, number>([
    ["Team #4", 20],
    ["Team #COE", 26],
  ]);

  it("returns active users in the Scoro group only", () => {
    const users = [
      user(14, "dominik.wycislo@admindagency.com", [20, 37]),
      user(100, "julia.piwowarska@admindagency.com", [20, 37]),
      user(167, "oliwia.glod@admindagency.com", [20, 37]),
      user(115, "wiktor.skawski@admindagency.com", [20, 37]),
      user(96, "monika.pabian@admindagency.com", [44, 29], true),
    ];
    const { members, source } = resolveTeamRosterFromScoro("4", users, groups);
    expect(source).toBe("scoro");
    expect(members).toHaveLength(4);
    expect(members.map((m) => m.email)).not.toContain("monika.pabian@admindagency.com");
  });

  it("excludes inactive Scoro users from COE roster", () => {
    const users = [
      user(179, "hayley.smith@admindagency.com", [26]),
      user(61, "arkadiusz.haratym@admindagency.com", [26]),
      user(110, "benjamin.schweitzer@admindagency.com", [26], false),
    ];
    const { members, source } = resolveTeamRosterFromScoro("COE", users, groups);
    expect(source).toBe("scoro");
    expect(members).toHaveLength(2);
  });
});
