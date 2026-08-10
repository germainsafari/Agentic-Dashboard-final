import "server-only";

import { KPI_META, QUARTERS, type DataSource, type Period, type Quarter } from "./brand";

export type { DataSource } from "./brand";
import type { ResolvedDirector, ResolvedTeam } from "./directors";
import {
  mockEscalations,
  mockTeamStats,
  type MockEscalation,
  type TeamStats,
} from "./mock";
import { getCachedDirector } from "./snapshot-cache";
import { isSyncRunning, triggerSync, waitForSync } from "./sync";
import { staleSnapshotMs } from "./sync-schedule";

const BLOCKING_SYNC_TIMEOUT_MS = 8_000;

export type DirectorSnapshot = {
  director: ResolvedDirector;
  quarter: Period;
  updatedAt: string;
  teamStats: { team: ResolvedTeam; stats: TeamStats }[];
  escalations: MockEscalation[];
  kpiAchievement: { achieved: number; total: number };
  source: DataSource;
};

export async function buildSnapshot(
  director: ResolvedDirector,
  quarter: Period
): Promise<DirectorSnapshot> {
  const cached = await getCachedDirector(director.id);

  if (cached && isStale(cached.fetchedAt) && !isSyncRunning()) {
    triggerSync(director.id);
  }

  if (!cached && !isSyncRunning()) {
    triggerSync(director.id);
    await waitForSync(BLOCKING_SYNC_TIMEOUT_MS);
  } else if (!cached && isSyncRunning()) {
    await waitForSync(BLOCKING_SYNC_TIMEOUT_MS);
  }

  const afterSync = await getCachedDirector(director.id);

  if (afterSync && afterSync.teamStats.length > 0) {
    const hasLiveData = afterSync.teamStats.some((ts) =>
      Object.values(ts.stats.kpis).some((qMap) =>
        Object.values(qMap).some((v) => v > 0)
      )
    );

    return {
      director,
      quarter,
      updatedAt: formatUpdated(afterSync.fetchedAt),
      teamStats: afterSync.teamStats,
      escalations: dedupeEscalations(afterSync.escalations),
      kpiAchievement: computeKpiAchievement(afterSync.teamStats, quarter),
      source: hasLiveData ? "scoro" : "fallback",
    };
  }

  return {
    director,
    quarter,
    updatedAt: formatUpdated(),
    teamStats: director.teams.map((team) => ({
      team,
      stats: mockTeamStats(director, team),
    })),
    escalations: mockEscalations(director),
    kpiAchievement: { achieved: 0, total: KPI_META.length },
    source: "fallback",
  };
}

function isStale(isoDate: string): boolean {
  const t = new Date(isoDate).getTime();
  return Number.isNaN(t) || Date.now() - t > staleSnapshotMs();
}

function quartersThrough(q: Period): Quarter[] {
  return q === "YTD" ? [...QUARTERS] : QUARTERS.slice(0, QUARTERS.indexOf(q) + 1);
}

function computeKpiAchievement(
  teamStats: { stats: TeamStats }[],
  quarter: Period
): { achieved: number; total: number } {
  let achieved = 0;

  for (const meta of KPI_META) {
    let sum = 0;
    let n = 0;
    if (quarter === "YTD") {
      // Read the precomputed YTD value directly (sum-then-divide already done
      // in loadTeamBundleFromScoro) rather than re-averaging quarterly percentages.
      for (const { stats } of teamStats) {
        sum += stats.kpis[meta.key]["YTD"] ?? 0;
        n++;
      }
    } else {
      const qs = quartersThrough(quarter);
      for (const { stats } of teamStats) {
        const values = stats.kpis[meta.key];
        for (const q of qs) {
          sum += values[q] ?? 0;
          n++;
        }
      }
    }
    const avg = n > 0 ? sum / n : 0;
    if (avg >= meta.goal) achieved++;
  }

  return { achieved, total: KPI_META.length };
}

/**
 * Escalation attribution is now deterministic (resolveEscalationsForOrg
 * resolves each task to at most one director) — this only guards against
 * the same task being seen twice, not against genuine attribution conflicts.
 */
function dedupeEscalations(list: MockEscalation[]): MockEscalation[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = e.projectId != null ? `pid:${e.projectId}` : `id:${e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatUpdated(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date();
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time} CET`;
}
