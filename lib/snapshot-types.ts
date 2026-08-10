import type { ResolvedTeam } from "./directors";
import type { MockEscalation, TeamStats } from "./mock";

/** One sync's team rosters (emails per team code). */
export type TeamRosterSnapshot = {
  syncedAt: string;
  byTeam: Record<string, string[]>;
};

export type DirectorCacheEntry = {
  directorId: string;
  teamStats: { team: ResolvedTeam; stats: TeamStats }[];
  escalations: MockEscalation[];
  fetchedAt: string;
};

export type SyncMeta = {
  lastSyncAt: string | null;
  lastSyncDurationMs: number | null;
  syncError: string | null;
  /** Cached Scoro bookmark id for "All Offer Prep projects" (resolved via user token). */
  offerPrepBookmarkId?: number | null;
  /** Per-sync team membership snapshots for historical headcount / utilization. */
  rosterHistory?: TeamRosterSnapshot[];
};
