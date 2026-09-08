"use client";

import React from "react";
import { Donut } from "@/components/ui/Donut";
import { GoalBar } from "@/components/ui/GoalBar";
import { COLORS, KPI_META, type Period } from "@/lib/brand";
import { isFtaMutedForTeam } from "@/lib/fta-display";
import type { ResolvedDirector } from "@/lib/directors";
import type { TeamStats } from "@/lib/mock";
import { TeamHeader } from "./TeamHeader";
import { KpiTooltip } from "./KpiTooltip";

type TeamBundle = { team: ResolvedDirector["teams"][number]; stats: TeamStats };

type HoverState = { teamIdx: number; kpiKey: string; x: number; y: number } | null;

type Props = {
  director: ResolvedDirector;
  teamStats: TeamBundle[];
  quarter: Period;
  escalationsByTeam: Record<string, number>;
  onTeamClick: (teamIdx: number, mode?: "escalation") => void;
  ftaEnabledTeamCodes: string[];
};

export function LayoutRows({
  director,
  teamStats,
  quarter,
  escalationsByTeam,
  onTeamClick,
  ftaEnabledTeamCodes,
}: Props) {
  const [hover, setHover] = React.useState<HoverState>(null);
  const ftaMutedForTeam = (teamCode: string) =>
    isFtaMutedForTeam(teamCode, ftaEnabledTeamCodes);

  return (
    <div className="relative pt-7">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `260px repeat(${KPI_META.length}, minmax(0, 1fr))`,
          padding: "12px 0",
          borderBottom: `1px solid ${COLORS.hairline}`,
        }}
      >
        <div
          className="uppercase text-muted"
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            padding: "0 20px 0 0",
          }}
        >
          Team · {quarter}
        </div>
        {KPI_META.map((meta) => (
          <div key={meta.key} style={{ padding: "0 16px" }}>
            <div
              className="font-sans"
              style={{
                fontSize: 14,
                letterSpacing: "-0.01em",
                lineHeight: 1.2,
                color: COLORS.ink,
              }}
            >
              {meta.shortLabel ?? meta.label}
            </div>
            <div
              className="mt-0.5 text-muted"
              style={{ fontSize: 10 }}
            >
              Goal {meta.goal}%
            </div>
          </div>
        ))}
      </div>

      {teamStats.map(({ team, stats }, ti) => {
        const escCount = escalationsByTeam[team.code] ?? 0;
        return (
          <div
            key={team.code}
            style={{
              display: "grid",
              gridTemplateColumns: `260px repeat(${KPI_META.length}, minmax(0, 1fr))`,
              alignItems: "center",
              borderBottom:
                ti < teamStats.length - 1 ? `1px solid ${COLORS.hairline}` : "none",
              minHeight: 132,
            }}
          >
            <div style={{ padding: "20px 20px 20px 0", position: "relative" }}>
              <TeamHeader
                team={team}
                idx={ti}
                activeProjects={stats.activeProjects}
                onClick={() => onTeamClick(ti)}
              />
              {escCount > 0 && (
                <button
                  type="button"
                  onClick={() => onTeamClick(ti, "escalation")}
                  className="border-0 cursor-pointer uppercase inline-flex items-center gap-1.5 mt-2"
                  style={{
                    padding: "4px 8px",
                    background: COLORS.tangerine,
                    color: "#fff",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#fff",
                    }}
                  />
                  {escCount} escalation{escCount > 1 ? "s" : ""}
                </button>
              )}
            </div>
            {KPI_META.map((meta) => {
              const values = stats.kpis[meta.key];
              const v = values[quarter];
              const isHover =
                hover?.teamIdx === ti && hover?.kpiKey === meta.key;
              const ftaMuted = meta.key === "fta" && ftaMutedForTeam(team.code);
              return (
                <div
                  key={meta.key}
                  onMouseEnter={(e) =>
                    setHover({
                      teamIdx: ti,
                      kpiKey: meta.key,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onMouseMove={(e) =>
                    setHover((prev) =>
                      prev && prev.teamIdx === ti && prev.kpiKey === meta.key
                        ? { ...prev, x: e.clientX, y: e.clientY }
                        : prev
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                  style={{
                    padding:
                      meta.kind === "donut" ? "20px 16px" : "55px 16px 20px 16px",
                    alignSelf: "stretch",
                    display: "grid",
                    gridTemplateRows: `${meta.kind === "donut" ? "1fr" : "44px"} auto`,
                    alignItems: "center",
                    rowGap: meta.kind === "donut" ? 8 : 2,
                    cursor: "default",
                    background: isHover ? COLORS.subtleBg : "transparent",
                    transition: "background 0.12s ease",
                  }}
                >
                  <div
                    style={{
                      alignSelf: meta.kind === "donut" ? "center" : "start",
                      display: "flex",
                      alignItems:
                        meta.kind === "donut" ? "center" : "flex-start",
                      width: "100%",
                      justifyContent:
                        meta.kind === "donut" ? "center" : "stretch",
                    }}
                  >
                    {meta.kind === "donut" ? (
                      <Donut value={v} goal={meta.goal} size={108} thickness={5} />
                    ) : (
                      <GoalBar value={v} goal={meta.goal} compact muted={ftaMuted} />
                    )}
                  </div>
                  <div
                    className="italic"
                    style={{
                      minHeight: 14,
                      fontSize: 10,
                      lineHeight: "33px",
                      color: ftaMuted ? COLORS.gray03 : undefined,
                      opacity: ftaMuted ? 0.85 : 1,
                    }}
                  >
                    {(() => {
                      const pa = stats.projectsAnalyzed as Record<string, number | undefined>;
                      const pitchKeys = new Set(["newBizWin", "existingWin"]);
                      const debugForQuarter =
                        stats.kpiDebug?.[meta.key as keyof typeof stats.kpiDebug]?.[quarter];
                      // Pitch KPIs carry their quarter-specific pool size directly;
                      // fta/estimate's per-quarter count is their debug denominator
                      // instead — projectsAnalyzed (pa) is a YEAR-WIDE total summed
                      // across all four quarters, so using it here made this caption
                      // show the same count no matter which quarter was selected.
                      // Only fall back to it when kpiDebug has no data at all (e.g.
                      // an older cached snapshot).
                      const n = pitchKeys.has(meta.key)
                        ? (debugForQuarter?.poolSize ?? pa[meta.key])
                        : (debugForQuarter?.denominator ?? pa[meta.key]);
                      const label = pitchKeys.has(meta.key) ? "pitch tasks analyzed" : "projects analyzed";
                      return n != null && n > 0 ? `${n} ${label}` : "";
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {hover &&
        (() => {
          const bundle = teamStats[hover.teamIdx];
          const meta = KPI_META.find((m) => m.key === hover.kpiKey);
          if (!bundle || !meta) return null;
          const tooltipFtaMuted =
            meta.key === "fta" && ftaMutedForTeam(bundle.team.code);
          return (
            <KpiTooltip
              x={hover.x}
              y={hover.y}
              meta={meta}
              quarter={quarter}
              values={bundle.stats.kpis[meta.key]}
              muted={tooltipFtaMuted}
            />
          );
        })()}
    </div>
  );
}
