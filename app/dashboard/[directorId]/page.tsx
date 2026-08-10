import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PERIODS, type Period } from "@/lib/brand";
import { DIRECTOR_SEEDS, resolveDirector } from "@/lib/directors";
import { getFtaEnabledTeamCodesFromEnv } from "@/lib/fta-rollout";
import { buildSnapshot } from "@/lib/kpi";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return DIRECTOR_SEEDS.map((d) => ({ directorId: d.id }));
}

type PageProps = {
  params: { directorId: string };
  searchParams: { q?: string };
};

export default async function DirectorDashboardPage({ params, searchParams }: PageProps) {
  const director = resolveDirector(params.directorId);
  if (!director) notFound();

  const rawQ = searchParams?.q ?? "Q2";
  const quarter: Period = (PERIODS as readonly string[]).includes(rawQ)
    ? (rawQ as Period)
    : "Q2";

  const snapshot = await buildSnapshot(director, quarter);
  const ftaEnabledTeamCodes = getFtaEnabledTeamCodesFromEnv();

  return (
    <DashboardShell
      director={director}
      quarter={quarter}
      updatedAt={snapshot.updatedAt}
      dataSource={snapshot.source}
      teamStats={snapshot.teamStats}
      escalations={snapshot.escalations}
      kpiAchievement={snapshot.kpiAchievement}
      ftaEnabledTeamCodes={ftaEnabledTeamCodes}
    />
  );
}
