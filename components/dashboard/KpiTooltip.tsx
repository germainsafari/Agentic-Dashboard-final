"use client";

import { QuarterSpark } from "@/components/ui/QuarterSpark";
import { COLORS, type KpiMeta, type Period, type Quarter } from "@/lib/brand";

type Props = {
  x: number;
  y: number;
  meta: KpiMeta;
  quarter: Period;
  values: Record<string, number>;
  /** FTA pilot: de-emphasize tooltip. */
  muted?: boolean;
};

export function KpiTooltip({ x, y, meta, quarter, values, muted = false }: Props) {
  const primary = muted ? "#b0b0b0" : "#fff";
  const secondary = muted ? "#6a6a6a" : COLORS.gray03;
  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y - 12,
        transform: "translate(-50%, -100%)",
        background: COLORS.ink,
        color: primary,
        padding: "10px 12px",
        fontSize: 11,
        lineHeight: 1.45,
        maxWidth: 260,
        pointerEvents: "none",
        zIndex: 100,
        boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
        opacity: muted ? 0.92 : 1,
      }}
    >
      <div
        style={{
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: secondary,
          fontSize: 9,
          marginBottom: 4,
        }}
      >
        {meta.label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <div
          style={{
            fontSize: 24,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: primary,
          }}
        >
          {values[quarter]}%
        </div>
        <div style={{ fontSize: 10, color: secondary }}>
          vs {meta.goal}% goal · {quarter}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <QuarterSpark
          values={["Q1", "Q2", "Q3", "Q4"].map((q) => values[q])}
          goal={meta.goal}
          muted={muted}
        />
        <div style={{ fontSize: 10, color: secondary, lineHeight: 1.4 }}>
          {(["Q1", "Q2", "Q3", "Q4"] as Quarter[]).map((q) => (
            <div
              key={q}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span>{q}</span>
              <span style={{ color: q === quarter ? primary : secondary }}>
                {values[q]}%
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: secondary,
          borderTop: "1px solid #333",
          paddingTop: 6,
        }}
      >
        {muted && meta.key === "fta" ? (
          <>
            <div style={{ marginBottom: 6, fontStyle: "italic" }}>
              FTA pilot — not enabled for this team yet.
            </div>
            {meta.note}
          </>
        ) : (
          meta.note
        )}
      </div>
    </div>
  );
}
