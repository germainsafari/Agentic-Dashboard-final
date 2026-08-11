"use client";

import React from "react";
import { ChatBot } from "./ChatBot";
import { EscalationPanel } from "./EscalationPanel";
import { Header } from "./Header";
import { LayoutCards } from "./LayoutCards";
import { LayoutRows } from "./LayoutRows";
import { QuarterBar } from "./QuarterBar";
import { TeamDrilldown } from "./TeamDrilldown";
import { COLORS, PERIODS, type DataSource, type Period } from "@/lib/brand";
import { isFtaMutedForTeam } from "@/lib/fta-display";
import type { ResolvedDirector } from "@/lib/directors";
import type { MockEscalation, TeamStats } from "@/lib/mock";

type Props = {
  director: ResolvedDirector;
  quarter: Period;
  updatedAt: string;
  dataSource: DataSource;
  teamStats: { team: ResolvedDirector["teams"][number]; stats: TeamStats }[];
  escalations: MockEscalation[];
  kpiAchievement: { achieved: number; total: number };
  /** Team codes with FTA in full color; empty = all teams. */
  ftaEnabledTeamCodes: string[];
};

export function DashboardShell({
  director,
  quarter: initialQuarter,
  updatedAt,
  dataSource,
  teamStats,
  escalations,
  kpiAchievement,
  ftaEnabledTeamCodes,
}: Props) {
  const [quarter, setQuarter] = React.useState<Period>(initialQuarter);
  const [isMobile, setIsMobile] = React.useState(false);
  const [escOpen, setEscOpen] = React.useState(false);
  const [drill, setDrill] = React.useState<
    { teamIdx: number; focusEscalation: boolean } | null
  >(null);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 1280px)");
    setIsMobile(mq.matches);
    const on = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const map: Record<string, Period> = { "1": "Q1", "2": "Q2", "3": "Q3", "4": "Q4", "5": "YTD" };
      if (map[e.key]) setQuarter(map[e.key]);
      if (e.key === "Escape") {
        setDrill(null);
        setEscOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const escalationsByTeam = React.useMemo(() => {
    const o: Record<string, number> = {};
    for (const e of escalations) {
      o[e.teamCode] = (o[e.teamCode] ?? 0) + 1;
    }
    return o;
  }, [escalations]);

  const handleTeamClick = (teamIdx: number, mode?: "escalation") => {
    setDrill({ teamIdx, focusEscalation: mode === "escalation" });
  };

  return (
    <div
      className="mx-auto bg-white shadow-page min-h-screen"
      style={{ maxWidth: 1680 }}
    >
      <Header
        director={director}
        updatedAt={updatedAt}
        dataSource={dataSource}
        escalationCount={escalations.length}
        kpiAchievement={kpiAchievement}
        onEscalationClick={() => setEscOpen(true)}
      />
      <QuarterBar quarter={quarter} onChange={setQuarter} />

      <div
        className="px-12 pb-16"
        style={{ paddingTop: isMobile ? 28 : 0 }}
      >
        {isMobile ? (
          <LayoutCards
            teamStats={teamStats}
            quarter={quarter}
            escalationsByTeam={escalationsByTeam}
            onTeamClick={handleTeamClick}
            ftaEnabledTeamCodes={ftaEnabledTeamCodes}
          />
        ) : (
          <LayoutRows
            director={director}
            teamStats={teamStats}
            quarter={quarter}
            escalationsByTeam={escalationsByTeam}
            onTeamClick={handleTeamClick}
            ftaEnabledTeamCodes={ftaEnabledTeamCodes}
          />
        )}
      </div>

      <footer
        className="px-12 py-4 flex justify-between uppercase text-muted"
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          borderTop: `1px solid ${COLORS.hairline}`,
        }}
      >
        <span>
          Admind · {director.role} Dashboard · {new Date().getFullYear()}
        </span>
        <span>
          {dataSource === "scoro"
            ? "Scoro data — reload page to refresh · Press "
            : "Scoro unavailable — showing zeros · Press "}
          {PERIODS.join("/")}‍⇢
        </span>
      </footer>

      <EscalationPanel
        open={escOpen}
        onClose={() => setEscOpen(false)}
        director={director}
        escalations={escalations}
      />

      <ChatBot
        director={director}
        quarter={quarter}
        teamStats={teamStats}
        escalations={escalations}
        kpiAchievement={kpiAchievement}
      />

      {drill && (
        <TeamDrilldown
          director={director}
          team={teamStats[drill.teamIdx].team}
          stats={teamStats[drill.teamIdx].stats}
          escalations={escalations.filter(
            (e) => e.teamCode === teamStats[drill.teamIdx].team.code
          )}
          focusEscalation={drill.focusEscalation}
          quarter={quarter}
          onClose={() => setDrill(null)}
          ftaMuted={isFtaMutedForTeam(
            teamStats[drill.teamIdx].team.code,
            ftaEnabledTeamCodes
          )}
        />
      )}
    </div>
  );
}
