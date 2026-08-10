import "server-only";

/** Expected days between full Scoro refreshes (cron interval). Default: 3. */
export function syncIntervalDays(): number {
  const d = Number(process.env.SYNC_INTERVAL_DAYS);
  if (Number.isFinite(d) && d > 0) return Math.floor(d);
  return 3;
}

/** When a snapshot is older than this, serve it but trigger a background refresh. */
export function staleSnapshotMs(): number {
  const days = syncIntervalDays();
  // Interval + 12 h buffer so we don't re-sync on every page view right after cron.
  return (days * 24 + 12) * 60 * 60 * 1000;
}

/** Redis TTL for director snapshots — interval + 4 days so data survives a missed run. */
export function snapshotKvTtlSeconds(): number {
  return (syncIntervalDays() + 4) * 24 * 60 * 60;
}

/** Standard cron expression: staggered director syncs every N days at 05:00 UTC. */
export function cronScheduleEveryNDays(minuteOffset = 0): string {
  const days = syncIntervalDays();
  return `${minuteOffset} 5 */${days} * *`;
}
