import "server-only";

import OpenAI from "openai";
import { KPI_META, type KpiKey, type Quarter } from "./brand";

const KEY = process.env.OPENAI_API_KEY;

/**
 * Primary model, then fallback. Override via OPENAI_MODEL in .env
 * (comma-separated, tried in order).
 */
const MODEL_CANDIDATES = (
  process.env.OPENAI_MODEL ?? "gpt-4o,gpt-4o-mini"
).split(",");

export type InsightRequest = {
  directorName: string;
  teamName: string;
  kpi: KpiKey;
  values: Record<Quarter, number>;
};

export async function kpiInsight(req: InsightRequest): Promise<string> {
  const meta = KPI_META.find((m) => m.key === req.kpi);
  if (!meta) return "Unknown KPI.";

  const bestQuarter = (["Q1", "Q2", "Q3", "Q4"] as Quarter[]).reduce(
    (best, q) => (req.values[q] > req.values[best] ? q : best),
    "Q1" as Quarter,
  );
  const worst = (["Q1", "Q2", "Q3", "Q4"] as Quarter[]).reduce(
    (w, q) => (req.values[q] < req.values[w] ? q : w),
    "Q1" as Quarter,
  );
  const q4 = req.values.Q4;
  const gap = q4 - meta.goal;
  const overallTrend = req.values.Q4 - req.values.Q1;

  const systemPrompt = [
    "You are a sharp, experienced operations analyst for Admind, a creative agency.",
    "You brief Creative Directors on their team's performance data in a concise, direct, and intelligent way.",
    "Your tone is professional but human — no corporate fluff, no filler phrases like 'It is worth noting'.",
    "You speak like a trusted advisor who has looked at this data carefully.",
  ].join(" ");

  const userPrompt = [
    `Director: ${req.directorName}`,
    `Team: ${req.teamName}`,
    `KPI: ${meta.label} (target: ${meta.goal}%)`,
    `Quarterly values: Q1=${req.values.Q1}% · Q2=${req.values.Q2}% · Q3=${req.values.Q3}% · Q4=${req.values.Q4}%`,
    `Context: best quarter was ${bestQuarter} (${req.values[bestQuarter]}%), worst was ${worst} (${req.values[worst]}%).`,
    `Overall Q1→Q4 change: ${overallTrend > 0 ? "+" : ""}${overallTrend}pt. Current gap to target: ${gap >= 0 ? "+" : ""}${gap}pt.`,
    "",
    "Write ONE tight paragraph (40–55 words):",
    "1. Describe the trend across the year — be specific about the shape (steady climb, mid-year dip, late recovery, etc.).",
    "2. Name the single most important risk or opportunity right now.",
    "3. Give one concrete, actionable next step the director should take this week.",
    "No bullet points. No emojis. No preamble. Start directly with the insight.",
  ].join("\n");

  if (!KEY) {
    console.warn("[agent] OPENAI_API_KEY not set, using heuristic fallback.");
    return fallbackInsight(req, meta.label, meta.goal);
  }

  const client = new OpenAI({ apiKey: KEY });

  for (const raw of MODEL_CANDIDATES) {
    const model = raw.trim();
    if (!model) continue;
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 150,
        temperature: 0.5,
      });
      const text = response.choices[0]?.message?.content?.trim();
      if (text) return text;
    } catch (err) {
      console.warn(`[agent] model ${model} failed:`, err);
    }
  }

  console.warn("[agent] all models exhausted, using heuristic fallback.");
  return fallbackInsight(req, meta.label, meta.goal);
}

function fallbackInsight(req: InsightRequest, label: string, goal: number): string {
  const q4 = req.values.Q4;
  const q1 = req.values.Q1;
  const delta = q4 - q1;
  const trend = delta > 2 ? "trending up" : delta < -2 ? "slipping" : "flat";
  const gap = q4 - goal;
  const risk =
    gap >= 0
      ? `beating goal by ${gap}pt`
      : `${Math.abs(gap)}pt below the ${goal}% target`;
  return `${req.teamName} is ${trend} on ${label} and currently ${risk}. Protect the win by briefing the team on what moved Q${delta >= 0 ? 4 : 1}'s number; schedule a 20-minute retro this week before the next pitch.`;
}
