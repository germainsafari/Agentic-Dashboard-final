import { describe, expect, it } from "vitest";
import { appendRosterSnapshot, rosterEmailsForQuarter } from "./roster-history";

describe("rosterEmailsForQuarter", () => {
  it("unions current roster with snapshots captured in the quarter", () => {
    const history = appendRosterSnapshot([], "2026-04-01T12:00:00.000Z", {
      "4": ["alice@admind.com"],
    });
    const emails = rosterEmailsForQuarter(
      "4",
      ["bob@admind.com"],
      history,
      2026,
      "Q2"
    );
    expect(emails.sort()).toEqual(["alice@admind.com", "bob@admind.com"].sort());
  });

  it("includes previous sync roster when mid-quarter moves occur", () => {
    const history = appendRosterSnapshot(
      appendRosterSnapshot([], "2026-03-20T12:00:00.000Z", {
        "4": ["alice@admind.com"],
      }),
      "2026-04-15T12:00:00.000Z",
      { "4": ["bob@admind.com"] }
    );
    const emails = rosterEmailsForQuarter(
      "4",
      ["bob@admind.com"],
      history,
      2026,
      "Q2"
    );
    expect(emails).toContain("alice@admind.com");
    expect(emails).toContain("bob@admind.com");
  });
});
