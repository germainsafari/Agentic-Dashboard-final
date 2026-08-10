import { NextResponse } from "next/server";
import { z } from "zod";
import { kpiInsight } from "@/lib/gemini";

const QuarterVals = z.object({
  Q1: z.number(),
  Q2: z.number(),
  Q3: z.number(),
  Q4: z.number(),
});

const Body = z.object({
  directorName: z.string().min(1),
  teamName: z.string().min(1),
  kpi: z.enum([
    "utilization",
    "billable",
    "fta",
    "estimate",
    "newBizWin",
    "existingWin",
  ]),
  values: QuarterVals,
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const insight = await kpiInsight(parsed.data);
  return NextResponse.json({ insight });
}
