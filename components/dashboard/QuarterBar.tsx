"use client";

import { COLORS, PERIODS, type Period } from "@/lib/brand";

type Props = {
  quarter: Period;
  onChange: (q: Period) => void;
  year?: number;
};

export function QuarterBar({ quarter, onChange, year = new Date().getFullYear() }: Props) {
  return (
    <div
      className="px-12 flex items-stretch"
      style={{
        background: COLORS.ink,
        color: "#fff",
        borderBottom: "1px solid #1A1A1A",
      }}
    >
      <div
        className="flex items-center uppercase"
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "#8A8A8A",
          paddingRight: 36,
        }}
      >
        Fiscal year{" "}
        <span className="text-white ml-2 tabular">{year}</span>
      </div>
      <div className="flex items-stretch flex-1">
        {PERIODS.map((q) => {
          const active = q === quarter;
          return (
            <button
              key={q}
              type="button"
              onClick={() => onChange(q)}
              style={{
                background: active ? "#fff" : "transparent",
                color: active ? COLORS.ink : "#fff",
                border: 0,
                cursor: "pointer",
                fontSize: 22,
                letterSpacing: "-0.01em",
                padding: "14px 32px",
                borderRight: "1px solid #1A1A1A",
                borderLeft: q === "YTD" ? "1px solid #1A1A1A" : undefined,
                marginLeft: q === "YTD" ? 8 : undefined,
                transition: "background 0.12s ease, color 0.12s ease",
                lineHeight: 1,
              }}
            >
              {q}
            </button>
          );
        })}
      </div>
    </div>
  );
}
