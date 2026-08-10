import { describe, expect, it } from "vitest";
import {
  INTERNAL_NON_BILLABLE_GROUP_NAME,
  internalNonBillableActivityIds,
  isInternalNonBillableActivityId,
  type ScoroActivityRow,
} from "./scoro-activities";
import { projectCompletionQuarter } from "./scoro-live";

const rows: ScoroActivityRow[] = [
  { activity_id: 388, name: "Internal activities (non billable)", parent_id: 0, parent_name: "", is_group: 1 },
  { activity_id: 389, name: "Admind Meetings", parent_id: 388, parent_name: "Internal activities (non billable)", is_group: 0 },
  { activity_id: 390, name: "Admind Trainings", parent_id: 388, parent_name: "Internal activities (non billable)", is_group: 0 },
  { activity_id: 100, name: "Client work", parent_id: 0, parent_name: "", is_group: 0 },
];

describe("internalNonBillableActivityIds", () => {
  it("collects group row and descendants only", () => {
    const ids = internalNonBillableActivityIds(rows);
    expect(ids.has(388)).toBe(true);
    expect(ids.has(389)).toBe(true);
    expect(ids.has(390)).toBe(true);
    expect(ids.has(100)).toBe(false);
    expect(ids.size).toBe(3);
  });

  it("matches exact group name constant", () => {
    expect(INTERNAL_NON_BILLABLE_GROUP_NAME).toBe("Internal activities (non billable)");
  });
});

describe("isInternalNonBillableActivityId", () => {
  it("returns true for ids in the set", () => {
    const ids = internalNonBillableActivityIds(rows);
    expect(isInternalNonBillableActivityId(389, ids)).toBe(true);
    expect(isInternalNonBillableActivityId(100, ids)).toBe(false);
  });
});

describe("projectCompletionQuarter", () => {
  it("uses modified_date for completed projects in KPI year", () => {
    const q = projectCompletionQuarter(
      { status: "completed", status_name: "Invoiced", modified_date: "2026-05-15T10:00:00+02:00" },
      2026
    );
    expect(q).toBe("Q2");
  });

  it("ignores deadline when completion date is available", () => {
    const q = projectCompletionQuarter(
      {
        status: "completed",
        deadline: "2025-12-31",
        modified_date: "2026-02-10T10:00:00+01:00",
      },
      2026
    );
    expect(q).toBe("Q1");
  });
});
