import { NextRequest, NextResponse } from "next/server";
import { PERIODS, type Period } from "@/lib/brand";
import { resolveDirector } from "@/lib/directors";
import { buildSnapshot } from "@/lib/kpi";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { directorId: string } }
) {
  const director = resolveDirector(params.directorId);
  if (!director) {
    return NextResponse.json({ error: "director not found" }, { status: 404 });
  }
  const rawQ = req.nextUrl.searchParams.get("q") ?? "Q2";
  const quarter: Period = (PERIODS as readonly string[]).includes(rawQ)
    ? (rawQ as Period)
    : "Q2";

  const snapshot = await buildSnapshot(director, quarter);
  return NextResponse.json({
    director: { id: director.id, name: director.name, role: director.role },
    quarter,
    updatedAt: snapshot.updatedAt,
    teamStats: snapshot.teamStats.map(({ team, stats }) => ({
      team: {
        code: team.code,
        name: team.name,
        people: team.people,
        leadName: team.leadName,
      },
      stats,
    })),
    kpiAchievement: snapshot.kpiAchievement,
    source: snapshot.source,
  });
}
