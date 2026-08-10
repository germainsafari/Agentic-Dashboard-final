"use client";

import React from "react";
import { QuarterSpark } from "@/components/ui/QuarterSpark";
import { COLORS, KPI_META, QUARTERS, type Period, type Quarter } from "@/lib/brand";
import type { ResolvedDirector } from "@/lib/directors";
import type { MockEscalation, TeamStats } from "@/lib/mock";

type Props = {
  director: ResolvedDirector;
  team: ResolvedDirector["teams"][number];
  stats: TeamStats;
  escalations: MockEscalation[];
  focusEscalation: boolean;
  quarter: Period;
  onClose: () => void;
  /** FTA KPI greyed for teams not in pilot */
  ftaMuted: boolean;
};

export function TeamDrilldown({
  director,
  team,
  stats,
  escalations,
  focusEscalation,
  quarter,
  onClose,
  ftaMuted,
}: Props) {
  const [insights, setInsights] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState<Record<string, boolean>>({});

  const askInsight = async (kpiKey: string) => {
    if (insights[kpiKey] || loading[kpiKey]) return;
    setLoading((s) => ({ ...s, [kpiKey]: true }));
    try {
      const res = await fetch("/api/agent/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directorName: director.name,
          teamName: team.name,
          kpi: kpiKey,
          values: stats.kpis[kpiKey as keyof typeof stats.kpis],
        }),
      });
      const data = await res.json();
      setInsights((s) => ({ ...s, [kpiKey]: data.insight ?? "" }));
    } catch {
      setInsights((s) => ({ ...s, [kpiKey]: "Agent unavailable." }));
    } finally {
      setLoading((s) => ({ ...s, [kpiKey]: false }));
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(10,10,10,0.4)",
          zIndex: 60,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 780,
          maxWidth: "92vw",
          maxHeight: "86vh",
          background: "#fff",
          zIndex: 61,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "28px 32px",
            borderBottom: `1px solid ${COLORS.hairline}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              className="uppercase text-muted"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              {director.name} · Team detail
            </div>
            <div
              className="font-sans text-ink mt-2.5"
              style={{ fontSize: 44, letterSpacing: "-0.025em", lineHeight: 1 }}
            >
              {team.name}
            </div>
            <div className="text-muted mt-2" style={{ fontSize: 12 }}>
              Lead {team.leadName ?? "—"} · {team.people} people ·{" "}
              {stats.activeProjects} active projects
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer bg-transparent text-ink"
            style={{
              width: 32,
              height: 32,
              border: `1px solid ${COLORS.hairline}`,
              fontSize: 14,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "24px 32px", overflowY: "auto" }}>
          {focusEscalation && escalations.length > 0 && (
            <div
              style={{
                background: COLORS.tangerine,
                color: "#fff",
                padding: "14px 18px",
                marginBottom: 20,
                fontSize: 12,
                letterSpacing: "0.04em",
              }}
            >
              <span
                className="uppercase"
                style={{ letterSpacing: "0.12em", fontSize: 10 }}
              >
                {escalations.length} escalation{escalations.length > 1 ? "s" : ""}{" "}
                on this team →
              </span>{" "}
              {escalations.map((e) => e.project).join(" · ")}
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px 24px",
              marginBottom: 28,
            }}
          >
            {KPI_META.map((meta) => {
              const values = stats.kpis[meta.key];
              const current = values[quarter];
              const qIdx = quarter === "YTD" ? -1 : QUARTERS.indexOf(quarter);
              const prevQ = qIdx > 0 ? QUARTERS[qIdx - 1] : null;
              const delta = prevQ != null ? current - values[prevQ] : null;
              const rowFtaMuted = meta.key === "fta" && ftaMuted;
              const labelTone = rowFtaMuted ? COLORS.gray03 : undefined;
              const inkTone = rowFtaMuted ? COLORS.gray03 : COLORS.ink;
              return (
                <div
                  key={meta.key}
                  style={{
                    borderTop: `1px solid ${COLORS.hairline}`,
                    paddingTop: 14,
                    opacity: rowFtaMuted ? 0.92 : 1,
                  }}
                >
                  <div
                    className="uppercase mb-1"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      color: labelTone,
                    }}
                  >
                    <span className={rowFtaMuted ? "" : "text-muted"}>{meta.label}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div
                      className="font-sans leading-none"
                      style={{
                        fontSize: 26,
                        letterSpacing: "-0.02em",
                        color: inkTone,
                      }}
                    >
                      {current}%
                    </div>
                    {delta != null && (
                      <div
                        style={{
                          fontSize: 11,
                          color: rowFtaMuted
                            ? COLORS.gray03
                            : delta >= 0
                              ? COLORS.turquoise
                              : COLORS.tangerine,
                        }}
                      >
                        {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}pt
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <QuarterSpark
                      values={QUARTERS.map((q: Quarter) => values[q])}
                      goal={meta.goal}
                      width={200}
                      height={32}
                      muted={rowFtaMuted}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => askInsight(meta.key)}
                    disabled={
                      rowFtaMuted || !!insights[meta.key] || !!loading[meta.key]
                    }
                    className="border-0 bg-transparent cursor-pointer uppercase mt-2"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      borderBottom: `1px solid ${rowFtaMuted ? COLORS.gray03 : COLORS.ink}`,
                      paddingBottom: 2,
                      opacity: rowFtaMuted ? 0.55 : loading[meta.key] ? 0.5 : 1,
                      color: rowFtaMuted ? COLORS.gray03 : COLORS.ink,
                      cursor: rowFtaMuted ? "default" : "pointer",
                    }}
                  >
                    {rowFtaMuted
                      ? "FTA pilot off"
                      : loading[meta.key]
                        ? "Agent thinking…"
                        : insights[meta.key]
                          ? "Agent insight"
                          : "Ask the agent"}
                  </button>
                  {insights[meta.key] && (
                    <p
                      className="text-inkSoft mt-2"
                      style={{ fontSize: 12, lineHeight: 1.5 }}
                    >
                      {insights[meta.key]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
