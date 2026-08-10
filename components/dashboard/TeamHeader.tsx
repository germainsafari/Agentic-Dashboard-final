"use client";

import React from "react";
import { COLORS } from "@/lib/brand";
import type { ResolvedTeam } from "@/lib/directors";

type Props = {
  team: ResolvedTeam;
  idx: number;
  activeProjects: number;
  onClick?: () => void;
  variant?: "column" | "card" | "row";
};

export function TeamHeader({ team, idx, activeProjects, onClick, variant = "row" }: Props) {
  const [showMembers, setShowMembers] = React.useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-transparent border-0 p-0 cursor-pointer flex flex-col gap-1"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="font-sans text-ink leading-none relative"
          style={{ fontSize: 22, letterSpacing: "-0.01em" }}
          onMouseEnter={() => setShowMembers(true)}
          onMouseLeave={() => setShowMembers(false)}
        >
          {team.name}
          {showMembers && team.members.length > 0 && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 8,
                background: COLORS.ink,
                color: "#fff",
                padding: "10px 14px",
                fontSize: 11,
                lineHeight: 1.7,
                minWidth: 200,
                zIndex: 70,
                boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  color: COLORS.gray03,
                  marginBottom: 6,
                }}
              >
                {team.people} team member{team.people === 1 ? "" : "s"}
              </div>
              {team.members.map((m) => (
                <div
                  key={m.email}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span>{m.name}</span>
                  <span style={{ color: COLORS.gray03, fontSize: 10 }}>
                    {m.weeklyTarget}h/wk
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {variant !== "card" && (
          <div
            className="uppercase tracking-[0.1em] text-muted tabular"
            style={{ fontSize: 10 }}
          >
            {String(idx + 1).padStart(2, "0")}
          </div>
        )}
      </div>
      <div className="text-muted leading-[1.4]" style={{ fontSize: 11 }}>
        {team.people} people · {activeProjects} active projects
      </div>
      <div className="text-muted" style={{ fontSize: 11 }}>
        Lead: {team.leadName ?? "—"}
      </div>
    </button>
  );
}
