import { NextRequest, NextResponse } from "next/server";
import { getSyncStatus, triggerSync } from "@/lib/sync";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const status = await getSyncStatus();
  return NextResponse.json(status);
}

/** Background sync trigger — used by Render cron (scripts/cron-sync-all.mjs). */
export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const director = searchParams.get("director") ?? undefined;
  const result = triggerSync(director);
  return NextResponse.json(result, { status: result.started ? 202 : 409 });
}
