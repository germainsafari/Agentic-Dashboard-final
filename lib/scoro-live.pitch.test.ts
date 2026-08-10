import { describe, expect, it } from "vitest";
import {
  computePitchKpisFromTasks,
  getTaskBusinessArea,
  getTaskTagValue,
  isNewBusinessPitchTask,
  isTaskCompleted,
  pitchWeightFromTag,
  taskDateIso,
  taskIsLinkedToTeamUser,
  type PitchTaskRecord,
} from "./scoro-live";

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return overrides;
}

describe("pitch task field parsing", () => {
  it("reads c_tasktag by field id from v2 custom_fields array", () => {
    const row = task({
      custom_fields: [
        { id: "c_tasktag", name: "Task Tag", value: "Pitch (<10k PLN)", type: "dropdown" },
      ],
    });
    expect(getTaskTagValue(row)).toBe("Pitch (<10k PLN)");
    expect(pitchWeightFromTag(getTaskTagValue(row))).toBe(1);
  });

  it("classifies by business area only (budget type ignored)", () => {
    const nb = task({
      custom_fields: [
        { id: "c_businessarea", name: "Business area", value: "New Business" },
        { id: "c_budgettype", name: "Budget Type", value: "CE" },
      ],
    });
    expect(isNewBusinessPitchTask(nb)).toBe(true);

    const ce = task({
      custom_fields: [
        { id: "c_businessarea", name: "Business area", value: "CE" },
        { id: "c_budgettype", name: "Budget Type", value: "New Business" },
      ],
    });
    expect(isNewBusinessPitchTask(ce)).toBe(false);
  });

  it("recognizes Scoro completed status codes and status_name", () => {
    expect(isTaskCompleted(task({ status: "task_status9", status_name: "Completed" }))).toBe(true);
    expect(isTaskCompleted(task({ status: "task_status3", status_name: "In progress" }))).toBe(false);
  });

  it("uses datetime_due for quarter bucketing", () => {
    expect(taskDateIso(task({ datetime_due: "2026-07-01T23:59:00+02:00" }))).toBe("2026-07-01");
  });

  it("links tasks to team via assignees, owner, and assigned_to", () => {
    const row = task({
      owner_id: 13,
      assigned_to: 14,
      assignees: [{ user_id: 14, email: "dominik.wycislo@admindagency.com" }],
      related_users: [14, 13],
    });
    expect(taskIsLinkedToTeamUser(row, [14])).toBe(true);
    expect(taskIsLinkedToTeamUser(row, [99])).toBe(false);
  });
});

describe("computePitchKpisFromTasks", () => {
  it("computes weighted new business win rate from completed pitches only", () => {
    const rows: PitchTaskRecord[] = [
      { taskId: 99626, weight: 3, completed: true, won: true, isNewBusiness: true, quarter: "Q3" },
      { taskId: 99602, weight: 1, completed: true, won: false, isNewBusiness: true, quarter: "Q3" },
      { taskId: 99999, weight: 2, completed: false, won: false, isNewBusiness: true, quarter: "Q3" },
    ];
    const out = computePitchKpisFromTasks(rows, 2026);
    expect(out.newBizWin.Q3).toBe(75);
    expect(out.debug.newBizWin.Q3).toEqual({ numerator: 3, denominator: 4, poolSize: 2 });
  });
});
