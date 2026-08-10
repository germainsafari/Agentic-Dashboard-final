import type { Quarter } from "./brand";
import { quarterRange } from "./scoro-live";
import type { TeamRosterSnapshot } from "./snapshot-types";

export type { TeamRosterSnapshot };

const MAX_SNAPSHOTS = 120;

/** Append current rosters; trim oldest entries. */
export function appendRosterSnapshot(
  history: TeamRosterSnapshot[],
  syncedAt: string,
  byTeam: Record<string, string[]>
): TeamRosterSnapshot[] {
  const next = [...history, { syncedAt, byTeam }];
  if (next.length <= MAX_SNAPSHOTS) return next;
  return next.slice(next.length - MAX_SNAPSHOTS);
}

/**
 * Member emails to include for time-based KPIs in a quarter:
 * current roster ∪ any roster captured during the quarter ∪ previous sync snapshot.
 */
export function rosterEmailsForQuarter(
  teamCode: string,
  currentEmails: string[],
  history: TeamRosterSnapshot[],
  year: number,
  q: Quarter
): string[] {
  const { from, to } = quarterRange(year, q);
  const set = new Set(currentEmails.map((e) => e.toLowerCase()));

  for (const snap of history) {
    const day = snap.syncedAt.slice(0, 10);
    if (day >= from && day <= to) {
      for (const e of snap.byTeam[teamCode] ?? []) {
        set.add(e.toLowerCase());
      }
    }
  }

  if (history.length >= 2) {
    const prev = history[history.length - 2];
    for (const e of prev.byTeam[teamCode] ?? []) {
      set.add(e.toLowerCase());
    }
  }

  return [...set];
}

export function userIdsFromEmails(
  emails: string[],
  users: { id: number; email: string }[]
): number[] {
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const ids = new Set<number>();
  for (const e of emails) {
    const id = byEmail.get(e.toLowerCase());
    if (id != null) ids.add(id);
  }
  return [...ids];
}
