import { NextResponse } from "next/server";
import { isSyncRunning, triggerSyncSequential } from "@/lib/sync";
import { countCachedDirectors } from "@/lib/snapshot-cache";

export const dynamic = "force-dynamic";

/**
 * Called by Render as healthCheckPath after each deploy.
 * If the cache is empty (fresh deploy) we kick off a background sync that
 * processes directors one-at-a-time to stay within memory limits.
 */
export async function GET() {
  const cached = await countCachedDirectors();

  if (cached === 0 && !isSyncRunning()) {
    triggerSyncSequential();
    return NextResponse.json(
      { ok: true, status: "sync_started", cachedDirectors: 0 },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: isSyncRunning() ? "sync_in_progress" : "ready",
    cachedDirectors: cached,
  });
}
