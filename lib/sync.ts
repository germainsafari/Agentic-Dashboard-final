import "server-only";

import { allResolvedDirectors } from "./directors";
import { QUARTERS } from "./brand";
import {
  assignProjectsExclusiveToTeams,
  clearLiveCaches,
  fetchActiveProjectsForTeam,
  fetchLeadKpiProjectsForTeam,
  fetchProjectsForTeamUserIds,
  filterProjectsToTeamParticipants,
  kpiYear,
  loadTeamBundleFromScoro,
  resolveEscalationsForOrg,
  userIdsForTeam,
  type TeamProjectFetch,
} from "./scoro-live";
import { clearApiCache } from "./scoro-api";
import {
  loadScoroUserGroupIdsByName,
  loadScoroUsersDetailed,
  resolveTeamRosterFromScoro,
  withScoroRoster,
} from "./scoro-roster";
import {
  appendRosterSnapshot,
  rosterEmailsForQuarter,
  userIdsFromEmails,
} from "./roster-history";
import { mockTeamStats, mockEscalations } from "./mock";
import {
  getCachedDirector,
  setCachedDirector,
  readMeta,
  writeMeta,
  countCachedDirectors,
  isPersistentCacheEnabled,
  getPersistentStoreLabel,
  type DirectorCacheEntry,
} from "./snapshot-cache";
import { syncIntervalDays } from "./sync-schedule";

// ── In-process sync guard (one sync at a time per Node.js instance) ─────────
let syncRunning = false;
let lastSyncPromise: Promise<void> | null = null;

export function isSyncRunning(): boolean {
  return syncRunning;
}

export async function getSyncStatus() {
  const meta = await readMeta();
  const directorsCached = await countCachedDirectors();
  return {
    running: syncRunning,
    lastSyncAt: meta.lastSyncAt,
    lastSyncDurationMs: meta.lastSyncDurationMs,
    syncError: meta.syncError,
    directorsCached,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Trigger helpers ────────────────────────────────────────────────────────

export function triggerSync(directorId?: string): { started: boolean; message: string } {
  if (syncRunning) {
    return { started: false, message: "Sync already in progress" };
  }
  lastSyncPromise = runSync(directorId);
  return { started: true, message: directorId ? `Sync started for ${directorId}` : "Sync started" };
}

export async function waitForSync(timeoutMs?: number): Promise<void> {
  if (!lastSyncPromise) return;
  if (!timeoutMs) {
    await lastSyncPromise;
    return;
  }
  await Promise.race([
    lastSyncPromise,
    sleep(timeoutMs).then(() => undefined),
  ]);
}

/**
 * Sync all directors one at a time, clearing caches between each.
 * Much more memory-friendly than syncing all at once.
 */
export function triggerSyncSequential(): { started: boolean; message: string } {
  if (syncRunning) {
    return { started: false, message: "Sync already in progress" };
  }
  lastSyncPromise = runSyncSequential();
  return { started: true, message: "Sequential sync started (all directors)" };
}

async function runSyncSequential(): Promise<void> {
  const directors = allResolvedDirectors();
  for (const dir of directors) {
    await runSync(dir.id);
    // Between isolated director syncs, pause for rate limits
    await sleep(1000);
  }
}

// ── Core sync ──────────────────────────────────────────────────────────────

/**
 * Main sync function.
 * Pass a `directorId` to sync a single director (used by Vercel Cron).
 * Omit it to sync all directors sequentially (used locally / manual trigger).
 */
export async function runSync(directorId?: string): Promise<void> {
  if (syncRunning) return;
  syncRunning = true;
  const startMs = Date.now();

  const label = directorId ?? "all";
  console.log(`[sync] Starting sync (${label})...`);

  const currentMeta = await readMeta();

  try {
    const canUseScoro = !!(process.env.SCORO_API_KEY && process.env.COMPANY_BASE_URL);

    if (!canUseScoro) {
      console.warn("[sync] No Scoro credentials — writing mock data");
      const directors = allResolvedDirectors().filter(
        (d) => !directorId || d.id === directorId
      );
      for (const dir of directors) {
        await setCachedDirector({
          directorId: dir.id,
          teamStats: dir.teams.map((team) => ({ team, stats: mockTeamStats(dir, team) })),
          escalations: mockEscalations(dir),
          fetchedAt: new Date().toISOString(),
        });
      }
      await writeMeta({
        lastSyncAt: new Date().toISOString(),
        lastSyncDurationMs: Date.now() - startMs,
        syncError: null,
      });
      return;
    }

    console.log("[sync] Loading Scoro users and user groups...");
    const usersDetailed = await loadScoroUsersDetailed();
    const users = usersDetailed.map((u) => ({ id: u.id, email: u.email }));
    const groupIdsByName = await loadScoroUserGroupIdsByName();
    console.log(
      `[sync] Loaded ${users.length} Scoro users, ${groupIdsByName.size} user groups`
    );

    await sleep(300);

    const year = kpiYear();

    // Escalation attribution is org-wide (a task resolves to at most one of
    // the 9 directors, never to a team) — resolve once per sync run rather
    // than re-fetching per director/team.
    console.log("[sync] Resolving escalations org-wide...");
    const escalationsByDirector = await resolveEscalationsForOrg(users, year);
    await sleep(300);

    const prevRosterByTeam =
      currentMeta.rosterHistory?.[currentMeta.rosterHistory.length - 1]?.byTeam ?? {};
    const rosterHistory = appendRosterSnapshot(
      currentMeta.rosterHistory ?? [],
      new Date().toISOString(),
      { ...prevRosterByTeam }
    );
    const rosterIndex = rosterHistory.length - 1;

    const directors = allResolvedDirectors().filter(
      (d) => !directorId || d.id === directorId
    );

    for (const dir of directors) {
      console.log(`[sync] Processing ${dir.name} (${dir.teams.length} teams)...`);
      const previousEntry = await getCachedDirector(dir.id);
      const previousStatsByTeamCode = new Map(
        (previousEntry?.teamStats ?? []).map((ts) => [ts.team.code, ts.stats])
      );
      const entry: DirectorCacheEntry = {
        directorId: dir.id,
        teamStats: [],
        escalations: [],
        fetchedAt: new Date().toISOString(),
      };

      const fetchFailed = new Set<string>();
      const teamFetches: TeamProjectFetch[] = [];
      const teamLiveByCode = new Map<string, ReturnType<typeof withScoroRoster>>();

      for (const team of dir.teams) {
        const roster = resolveTeamRosterFromScoro(team.code, usersDetailed, groupIdsByName);
        const teamLive = withScoroRoster(team, roster.members);
        teamLiveByCode.set(team.code, teamLive);
        const ids = userIdsForTeam(teamLive, users);
        if (ids.length === 0) continue;
        try {
          const fetched = await fetchProjectsForTeamUserIds(ids);
          const filtered = filterProjectsToTeamParticipants(fetched, ids);
          teamFetches.push({ team: teamLive, userIds: ids, projects: filtered });
        } catch (e) {
          console.warn(`[sync]   projects fetch failed ${team.code}:`, e);
          fetchFailed.add(team.code);
        }
        await sleep(300);
      }

      const assignedExclusive = assignProjectsExclusiveToTeams(teamFetches);

      for (const team of dir.teams) {
        const teamLive = teamLiveByCode.get(team.code) ?? team;
        rosterHistory[rosterIndex].byTeam[team.code] = teamLive.members.map((m) =>
          m.email.toLowerCase()
        );

        const rosterEmails = new Set<string>();
        for (const q of QUARTERS) {
          for (const e of rosterEmailsForQuarter(
            team.code,
            teamLive.members.map((m) => m.email),
            rosterHistory.slice(0, rosterIndex),
            year,
            q
          )) {
            rosterEmails.add(e);
          }
        }
        const ids = userIdsFromEmails([...rosterEmails], users);
        if (ids.length > 0) {
          try {
            const teamProjects = teamFetches.find((f) => f.team.code === team.code)?.projects;
            const projectsForUtilization = fetchFailed.has(team.code)
              ? undefined
              : (assignedExclusive.get(team.code) ?? teamProjects ?? []);
            const leadKpiProjects = await fetchLeadKpiProjectsForTeam(
              teamLive,
              users,
              teamProjects ?? [],
              year
            );
            const activeResult = await fetchActiveProjectsForTeam(
              teamLive,
              users,
              teamProjects ?? []
            );
            const previousStats = previousStatsByTeamCode.get(team.code);
            const stats = await loadTeamBundleFromScoro(
              teamLive,
              ids,
              year,
              users,
              leadKpiProjects,
              projectsForUtilization ?? teamProjects,
              activeResult.projects,
              activeResult.details,
              previousStats && {
                utilization: previousStats.kpiDebug?.utilization ?? {},
                billable: previousStats.kpiDebug?.billable ?? {},
              }
            );
            entry.teamStats.push({ team: teamLive, stats });
            console.log(
              `[sync]   ✓ ${team.code} — ${ids.length} users, ${stats.activeProjects} active projects`
            );
          } catch (e) {
            console.warn(`[sync]   ✗ ${team.code} failed:`, e);
            entry.teamStats.push({ team: teamLive, stats: mockTeamStats(dir, teamLive) });
          }
        } else {
          console.warn(`[sync]   ✗ ${team.code} — no matching Scoro users`);
          entry.teamStats.push({ team: teamLive, stats: mockTeamStats(dir, teamLive) });
        }

        // Clear the large per-user API responses (time entries, tasks) that
        // are no longer needed after this team is processed. Project lists
        // are still cached and will be reused across teams in the same director.
        clearApiCache();
        if (typeof global.gc === "function") global.gc();

        await sleep(300);
      }

      entry.escalations = escalationsByDirector.get(dir.email) ?? [];

      await setCachedDirector(entry);
      console.log(`[sync] ✓ ${dir.name} saved to cache`);

      // Free API response cache between directors to avoid OOM on
      // memory-constrained hosts (Render free tier = 256 MB heap).
      clearApiCache();
      if (typeof global.gc === "function") global.gc();

      if (!directorId) {
        await sleep(500);
      }
    }

    await writeMeta({
      lastSyncAt: new Date().toISOString(),
      lastSyncDurationMs: Date.now() - startMs,
      syncError: null,
      rosterHistory,
    });

    if (!isPersistentCacheEnabled()) {
      console.warn(
        "[sync] DATABASE_URL / KV not set — snapshots are file-only and will not persist across deploys"
      );
    } else {
      console.log(
        `[sync] Snapshots persisted to ${getPersistentStoreLabel()} (refresh interval: every ${syncIntervalDays()} days)`
      );
    }

    console.log(
      `[sync] Complete (${label}) — ${((Date.now() - startMs) / 1000).toFixed(1)}s`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] Fatal error:", msg);
    await writeMeta({
      lastSyncAt: currentMeta.lastSyncAt,
      lastSyncDurationMs: Date.now() - startMs,
      syncError: msg,
    });
  } finally {
    clearApiCache();
    clearLiveCaches();
    if (typeof global.gc === "function") global.gc();
    syncRunning = false;
  }
}
