"use client";

import { COLORS, statusColor, statusOf } from "@/lib/brand";

type Props = {
  value: number;
  goal: number;
  size?: number;
  thickness?: number;
};

export function Donut({ value, goal, size = 148, thickness = 6 }: Props) {
  const status = statusOf(value, goal);
  const color = statusColor(status);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const dash = c * pct;
  const goalAngle = (goal / 100) * 360 - 90;
  const rad = (goalAngle * Math.PI) / 180;
  const goalX = size / 2 + (r + thickness / 2 + 1) * Math.cos(rad);
  const goalY = size / 2 + (r + thickness / 2 + 1) * Math.sin(rad);
  const goalInX = size / 2 + (r - thickness / 2 - 3) * Math.cos(rad);
  const goalInY = size / 2 + (r - thickness / 2 - 3) * Math.sin(rad);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="block">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLORS.gray01}
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={c / 4}
          strokeLinecap="butt"
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(.2,.8,.2,1)" }}
        />
        <line
          x1={goalInX}
          y1={goalInY}
          x2={goalX}
          y2={goalY}
          stroke={COLORS.ink}
          strokeWidth={1.5}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="font-sans text-ink leading-none"
          style={{ fontSize: size > 130 ? 34 : 26, letterSpacing: "-0.02em" }}
        >
          {value}
          <span style={{ fontSize: size > 130 ? 16 : 13, marginLeft: 1 }}>%</span>
        </div>
        <div
          className="uppercase tracking-[0.08em] text-muted mt-1"
          style={{ fontSize: 10 }}
        >
          {goal}% target
        </div>
      </div>
    </div>
  );
}
