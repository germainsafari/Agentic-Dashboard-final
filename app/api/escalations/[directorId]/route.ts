import { NextResponse } from "next/server";
import { resolveDirector } from "@/lib/directors";
import { buildSnapshot } from "@/lib/kpi";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { directorId: string } }
) {
  const director = resolveDirector(params.directorId);
  if (!director) {
    return NextResponse.json({ error: "director not found" }, { status: 404 });
  }
  const snap = await buildSnapshot(director, "Q1");
  return NextResponse.json({
    director: director.id,
    escalations: snap.escalations,
    source: snap.source,
  });
}
