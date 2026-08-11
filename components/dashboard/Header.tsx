"use client";

import React from "react";
import Link from "next/link";
import { COLORS, ESCALATION_YEARLY_MAX, type DataSource } from "@/lib/brand";
import type { ResolvedDirector } from "@/lib/directors";

type Props = {
  director: ResolvedDirector;
  updatedAt: string;
  dataSource: DataSource;
  escalationCount: number;
  kpiAchievement: { achieved: number; total: number };
  onEscalationClick: () => void;
};

const ESCALATION_TARGET = ESCALATION_YEARLY_MAX;

export function Header({
  director,
  updatedAt,
  dataSource,
  escalationCount,
  kpiAchievement,
  onEscalationClick,
}: Props) {
  return (
    <header
      className="px-12 pt-5"
      style={{ background: COLORS.peach, borderBottom: `1px solid ${COLORS.hairline}` }}
    >
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center gap-4">
          <svg width="30" height="30" viewBox="0 0 78 78" fill="none">
            <rect width="78" height="78" fill="#FF523D" />
            <path d="M45.2905 52.042H65.9605V54.031H45.2905V52.042Z" fill="white" />
            <path
              d="M36.057 42.7989H26.229L24.162 48.9999H18.429L27.555 22.1289H34.848L44.403 48.9999H38.28L36.057 42.7989ZM27.477 38.0409H34.809C32.898 32.3469 31.689 28.7199 31.026 26.3019H30.987C30.324 28.9539 28.998 33.1659 27.477 38.0409Z"
              fill="white"
            />
          </svg>
          <div
            className="uppercase text-ink"
            style={{ fontSize: 11, letterSpacing: "0.18em" }}
          >
            Admind <span className="text-muted">/ {director.role} Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href="/"
            className="text-muted no-underline hover:text-ink transition-colors"
            style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            ← Switch director
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="text-muted flex items-center gap-2"
              style={{ fontSize: 11 }}
            >
              <span
                className={dataSource === "scoro" ? "rounded-full animate-pulseDot" : "rounded-full"}
                style={{
                  width: 7,
                  height: 7,
                  background: dataSource === "scoro" ? COLORS.turquoise : COLORS.gray03,
                  display: "inline-block",
                }}
              />
              <span className="tabular">
                {dataSource === "scoro"
                  ? `Scoro · updated ${updatedAt}`
                  : `Offline · ${updatedAt}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="cd-identity pb-6"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "end",
          gap: 32,
        }}
      >
        <div className="min-w-0">
          <h1
            className="cd-name m-0 text-ink font-normal font-sans whitespace-nowrap"
            style={{ fontSize: 58, lineHeight: 0.95, letterSpacing: "-0.035em" }}
          >
            {director.name}
          </h1>
          <div className="mt-2">
            <span className="text-muted" style={{ fontSize: 12 }}>
              Managing {director.peopleTotal} people across {director.teams.length} teams ·{" "}
              {director.location}
            </span>
          </div>
        </div>

        <div
          className="flex items-stretch"
          style={{ border: `1px solid ${COLORS.hairline}` }}
        >
          <div
            className="flex flex-col gap-2"
            style={{
              padding: "12px 20px",
              borderRight: `1px solid ${COLORS.hairline}`,
              minWidth: 168,
            }}
          >
            <div
              className="uppercase text-muted"
              style={{ fontSize: 9, letterSpacing: "0.16em" }}
            >
              KPI Achievement
            </div>
            <div className="flex items-center gap-3">
              <AchievementRing
                achieved={kpiAchievement.achieved}
                total={kpiAchievement.total}
              />
              <div>
                <div
                  className="font-sans text-ink"
                  style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
                >
                  {kpiAchievement.achieved}{" "}
                  <span className="text-muted" style={{ fontSize: 14 }}>
                    / {kpiAchievement.total}
                  </span>
                </div>
                <div className="text-muted mt-1" style={{ fontSize: 10 }}>
                  KPIs achieved
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onEscalationClick}
            className="flex flex-col gap-2 cursor-pointer bg-transparent border-0 text-left hover:bg-subtleBg transition-colors"
            style={{ padding: "12px 20px", minWidth: 192 }}
          >
            <div className="flex justify-between items-center">
              <div
                className="uppercase text-muted"
                style={{ fontSize: 9, letterSpacing: "0.16em" }}
              >
                Project Escalations — {new Date().getFullYear()}
              </div>
              <span className="text-muted" style={{ fontSize: 10 }}>
                View →
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-baseline gap-1.5">
                <div
                  className="font-sans text-ink"
                  style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.02em" }}
                >
                  {escalationCount}
                </div>
                <div className="text-muted" style={{ fontSize: 11 }}>
                  / {ESCALATION_TARGET} max
                </div>
              </div>
              <div className="flex gap-[3px] flex-1">
                {Array.from({ length: ESCALATION_TARGET }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1"
                    style={{
                      height: 6,
                      background: i < escalationCount ? COLORS.tangerine : COLORS.gray01,
                    }}
                  />
                ))}
              </div>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}

function AchievementRing({ achieved, total }: { achieved: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? achieved / total : 0;
  return (
    <svg width={38} height={38}>
      <circle cx={19} cy={19} r={r} fill="none" stroke={COLORS.gray01} strokeWidth={3} />
      <circle
        cx={19}
        cy={19}
        r={r}
        fill="none"
        stroke={pct >= 0.5 ? COLORS.turquoise : COLORS.tangerine}
        strokeWidth={3}
        strokeDasharray={`${c * pct} ${c}`}
        strokeDashoffset={c / 4}
      />
    </svg>
  );
}
