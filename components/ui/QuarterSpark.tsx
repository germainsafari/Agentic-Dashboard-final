"use client";

import { COLORS } from "@/lib/brand";

type Props = {
  values: number[];
  goal: number;
  width?: number;
  height?: number;
  muted?: boolean;
};

export function QuarterSpark({ values, goal, width = 90, height = 28, muted = false }: Props) {
  const ink = muted ? COLORS.gray03 : COLORS.ink;
  const max = Math.max(...values, goal, 100);
  const min = 0;
  const step = width / (values.length - 1);
  const pts = values.map<[number, number]>((v, i) => [
    i * step,
    height - ((v - min) / (max - min)) * height,
  ]);
  const d = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const gy = height - ((goal - min) / (max - min)) * height;
  return (
    <svg width={width} height={height} className="block">
      <line
        x1={0}
        y1={gy}
        x2={width}
        y2={gy}
        stroke={COLORS.gray03}
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <path d={d} fill="none" stroke={ink} strokeWidth={1.25} />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2} fill={ink} />
      ))}
    </svg>
  );
}
