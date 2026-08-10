"use client";

import { COLORS, statusColor, statusOf } from "@/lib/brand";

type Props = {
  value: number;
  goal: number;
  compact?: boolean;
  /** De-emphasize (FTA pilot: team not in rollout). */
  muted?: boolean;
};

export function GoalBar({ value, goal, compact = false, muted = false }: Props) {
  const color = muted ? COLORS.gray02 : statusColor(statusOf(value, goal));
  const textInk = muted ? COLORS.gray03 : COLORS.ink;
  const labelMuted = muted ? COLORS.gray03 : undefined;
  const h = compact ? 6 : 8;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2 mb-[6px]">
        <span
          className="font-sans leading-none"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            color: textInk,
          }}
        >
          {value}
          <span style={{ fontSize: 12, color: labelMuted ?? COLORS.gray03 }}>%</span>
        </span>
        <span
          className="uppercase tracking-[0.08em]"
          style={{ fontSize: 10, color: labelMuted ?? COLORS.muted }}
        >
          {goal}% goal
        </span>
      </div>
        <div
          className="relative w-full bg-gray01"
          style={{ height: h, opacity: muted ? 0.65 : 1 }}
        >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${v}%`,
            background: muted ? COLORS.gray02 : color,
            transition: "width 0.5s cubic-bezier(.2,.8,.2,1)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -3,
            bottom: -3,
            left: `${goal}%`,
            width: 1,
            background: muted ? COLORS.gray02 : COLORS.ink,
          }}
        />
      </div>
    </div>
  );
}
