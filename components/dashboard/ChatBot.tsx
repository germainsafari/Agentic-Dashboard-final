"use client";

import React from "react";
import { COLORS, ESCALATION_YEARLY_MAX, KPI_META, type Period } from "@/lib/brand";
import type { ResolvedDirector } from "@/lib/directors";
import type { MockEscalation, TeamStats } from "@/lib/mock";

type Message = { role: "user" | "assistant"; content: string };

/**
 * Lightweight renderer: handles **bold**, numbered lists, and line breaks.
 * Keeps the minimal brand aesthetic — no heavy markdown library needed.
 */
function renderContent(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    const isNumbered = /^\s*(\d+)\.\s+/.test(line);
    const stripped = isNumbered ? line.replace(/^\s*\d+\.\s+/, "") : line;
    const num = isNumbered ? line.match(/^\s*(\d+)\./)![1] : null;

    // Parse **bold** spans within a line
    const parts = stripped.split(/(\*\*[^*]+\*\*)/g);
    const inline: React.ReactNode[] = parts.map((part, pi) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={pi} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    if (isNumbered) {
      nodes.push(
        <div
          key={li}
          style={{ display: "flex", gap: 6, marginTop: li === 0 ? 0 : 5 }}
        >
          <span style={{ flexShrink: 0, color: COLORS.muted }}>{num}.</span>
          <span>{inline}</span>
        </div>
      );
    } else if (line.trim() === "") {
      nodes.push(<div key={li} style={{ height: 6 }} />);
    } else {
      nodes.push(
        <div key={li} style={{ marginTop: li === 0 ? 0 : 3 }}>
          {inline}
        </div>
      );
    }
  });

  return <>{nodes}</>;
}

type Props = {
  director: ResolvedDirector;
  quarter: Period;
  teamStats: { team: ResolvedDirector["teams"][number]; stats: TeamStats }[];
  escalations: MockEscalation[];
  kpiAchievement: { achieved: number; total: number };
};

const PROMPT_CARDS = [
  { label: "How is this data fetched?", question: "How is the data on this dashboard fetched and how often does it update?" },
  { label: "What does utilization mean?", question: "Can you explain what Project Utilization means and how the 75% target is calculated?" },
  { label: "Which team needs attention?", question: "Based on the current KPI snapshot, which team needs the most attention right now?" },
  { label: "What are active projects?", question: "How is the active projects count calculated and what does it represent?" },
  { label: "Tell me about escalations", question: "What are project escalations on this dashboard and which teams currently have them?" },
  { label: "How are KPI goals set?", question: "How were the KPI targets on this dashboard defined?" },
];

export function ChatBot({ director, quarter, teamStats, escalations, kpiAchievement }: Props) {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Build a comprehensive context string for the AI agent.
  // Includes KPI percentages with raw inputs, active project counts,
  // projects-analyzed counts, escalations, and overall achievement.
  const kpiSummary = React.useMemo(() => {
    const secToHours = (s: number) => (s / 3600).toFixed(1);

    const teamBlocks = teamStats.map(({ team, stats }) => {
      const kpiLines = KPI_META.map((m) => {
        const v = stats.kpis[m.key];
        const d = stats.kpiDebug?.[m.key];
        const isTime = m.key === "utilization" || m.key === "billable";

        if (!d) {
          return `${m.shortLabel ?? m.label}: Q1=${v.Q1}% Q2=${v.Q2}% Q3=${v.Q3}% Q4=${v.Q4}%`;
        }

        const calc = (["Q1", "Q2", "Q3", "Q4"] as const)
          .map((q) => {
            const { numerator: num, denominator: den } = d[q] as { numerator: number; denominator: number };
            if (isTime) {
              return `${q}: ${secToHours(num)}h worked / ${secToHours(den)}h capacity = ${v[q]}%`;
            }
            return `${q}: ${num} won / ${den} total = ${v[q]}%`;
          })
          .join(" | ");

        return `${m.shortLabel ?? m.label}: ${calc}`;
      });

      const pa = stats.projectsAnalyzed;
      const analyzed = [
        `FTA=${pa.fta}`,
        `Estimate=${pa.estimate}`,
        `New Biz pitches=${pa.newBizWin}`,
        `Existing pitches=${pa.existingWin}`,
      ].join(", ");

      const teamEscalations = escalations.filter((e) => e.teamCode === team.code);
      const escLines =
        teamEscalations.length === 0
          ? "  Escalations: none"
          : teamEscalations
              .map(
                (e) =>
                  `  Escalation: "${e.project}" · ${e.quarter} · severity=${e.severity} · ${e.reason}`
              )
              .join("\n");

      const activeLines =
        stats.activeProjectDetails && stats.activeProjectDetails.length > 0
          ? stats.activeProjectDetails
              .map(
                (p) =>
                  `  Active project: "${p.name}" (id ${p.projectId}) · status=${p.status} · budget=${p.budgetType} · ${p.openTaskCount} open task(s) for design lead`
              )
              .join("\n")
          : stats.activeProjects === 0
            ? "  Active projects: none (design lead has no open client tasks on non-terminal projects)"
            : `  Active projects: ${stats.activeProjects} (project list unavailable — run sync to refresh)`;

      return [
        `Team "${team.name}" (code ${team.code}, lead ${team.leadEmail ?? "unknown"}, ${team.people} people):`,
        `  Active projects count: ${stats.activeProjects}`,
        activeLines,
        `  Projects analyzed: ${analyzed}`,
        `  ${kpiLines.join("\n  ")}`,
        escLines,
      ].join("\n");
    });

    const escTotal = escalations.length;
    const header = [
      `Overall KPI achievement in ${quarter}: ${kpiAchievement.achieved} of ${kpiAchievement.total} KPIs meeting target`,
      `Total escalations: ${escTotal} of ${ESCALATION_YEARLY_MAX} allowed slots used`,
    ].join("\n");

    return [header, "", ...teamBlocks].join("\n\n");
  }, [teamStats, escalations, kpiAchievement, quarter]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          context: {
            directorName: director.name,
            directorRole: director.role,
            teamCount: director.teams.length,
            teamNames: director.teams.map((t) => t.name),
            quarter,
            kpiSummary,
          },
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply ?? data.error ?? "Something went wrong." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 28,
        left: 28,
        zIndex: 70,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
      }}
    >
      {/* ── Chat panel ─────────────────────────────────────── */}
      {open && (
        <div
          style={{
            width: 380,
            maxHeight: 520,
            background: COLORS.paper,
            border: `1px solid ${COLORS.hairline}`,
            display: "flex",
            flexDirection: "column",
            marginBottom: 10,
            boxShadow: "0 8px 40px rgba(10,10,10,0.14)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 18px",
              borderBottom: `1px solid ${COLORS.hairline}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <div>
              <div
                className="uppercase"
                style={{ fontSize: 10, letterSpacing: "0.14em", color: COLORS.muted }}
              >
                Admind AI
              </div>
              <div style={{ fontSize: 13, color: COLORS.ink, marginTop: 2 }}>
                Ask about {director.name.split(" ")[0]}'s dashboard
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.hairline}`,
                color: COLORS.ink,
                width: 28,
                height: 28,
                fontSize: 13,
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {messages.length === 0 ? (
              <>
                <p style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6, margin: 0 }}>
                  Ask me anything about this dashboard — the data, the metrics, or the teams.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {PROMPT_CARDS.map((card) => (
                    <button
                      key={card.label}
                      type="button"
                      onClick={() => sendMessage(card.question)}
                      style={{
                        background: "transparent",
                        border: `1px solid ${COLORS.hairline}`,
                        padding: "9px 12px",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: 12,
                        color: COLORS.inkSoft,
                        lineHeight: 1.4,
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.tangerine)
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.hairline)
                      }
                    >
                      {card.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: msg.role === "assistant" ? "96%" : "84%",
                      padding: "9px 12px",
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: msg.role === "user" ? COLORS.paper : COLORS.ink,
                      background: msg.role === "user" ? COLORS.ink : COLORS.subtleBg,
                      border: msg.role === "assistant" ? `1px solid ${COLORS.hairline}` : "none",
                    }}
                  >
                    {msg.role === "assistant" ? renderContent(msg.content) : msg.content}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <div
                  style={{
                    padding: "9px 12px",
                    fontSize: 12,
                    color: COLORS.muted,
                    background: COLORS.subtleBg,
                    border: `1px solid ${COLORS.hairline}`,
                  }}
                >
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              borderTop: `1px solid ${COLORS.hairline}`,
              display: "flex",
              flexShrink: 0,
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask a question…"
              disabled={loading}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                padding: "12px 14px",
                fontSize: 12,
                color: COLORS.ink,
                background: COLORS.paper,
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                border: "none",
                borderLeft: `1px solid ${COLORS.hairline}`,
                background: input.trim() && !loading ? COLORS.ink : COLORS.subtleBg,
                color: input.trim() && !loading ? COLORS.paper : COLORS.muted,
                padding: "0 16px",
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: input.trim() && !loading ? "pointer" : "default",
                transition: "background 0.15s",
                fontFamily: "inherit",
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* ── Trigger button ─────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: open ? COLORS.ink : COLORS.ink,
          color: COLORS.paper,
          border: "none",
          padding: "10px 16px",
          cursor: "pointer",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "inherit",
          boxShadow: "0 4px 20px rgba(10,10,10,0.22)",
        }}
      >
        {/* Minimalist chat icon */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="12" height="9" rx="0" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4 13 L4 10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        {open ? "Close" : "Ask the agent"}
      </button>
    </div>
  );
}
