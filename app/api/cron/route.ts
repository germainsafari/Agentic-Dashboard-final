import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync";
import { allResolvedDirectors } from "@/lib/directors";
import { isPersistentCacheEnabled, getPersistentStoreLabel } from "@/lib/snapshot-cache";
import { syncIntervalDays } from "@/lib/sync-schedule";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scoro sync endpoint (blocking). Production cron uses Render — see render.yaml
 * and scripts/cron-sync-all.mjs, which POSTs to /api/sync and polls status
 * so long refreshes are not cut off by HTTP timeouts.
 *
 * Usage:
 *   GET /api/cron                    — sync all directors sequentially (may timeout)
 *   GET /api/cron?director=marta     — sync a single director
 *
 * Auth: Bearer token via CRON_SECRET env var (optional but recommended).
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const directorId = req.nextUrl.searchParams.get("director") ?? undefined;
  const startMs = Date.now();

  try {
    if (directorId) {
      await runSync(directorId);
    } else {
      const dirs = allResolvedDirectors();
      for (const dir of dirs) {
        await runSync(dir.id);
      }
    }
    return NextResponse.json({
      ok: true,
      director: directorId ?? "all",
      durationMs: Date.now() - startMs,
      persistentCache: isPersistentCacheEnabled(),
      store: getPersistentStoreLabel(),
      syncIntervalDays: syncIntervalDays(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
