"use client";

import { COLORS, ESCALATION_YEARLY_MAX } from "@/lib/brand";
import type { ResolvedDirector } from "@/lib/directors";
import type { MockEscalation } from "@/lib/mock";

type Props = {
  open: boolean;
  onClose: () => void;
  director: ResolvedDirector;
  escalations: MockEscalation[];
};

export function EscalationPanel({ open, onClose, director, escalations }: Props) {
  const byTeam: Record<string, MockEscalation[]> = {};
  for (const e of escalations) {
    (byTeam[e.teamName] = byTeam[e.teamName] || []).push(e);
  }
  const remaining = Math.max(0, ESCALATION_YEARLY_MAX - escalations.length);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: open ? "rgba(10,10,10,0.32)" : "transparent",
          pointerEvents: open ? "auto" : "none",
          transition: "background 0.25s ease",
          zIndex: 50,
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 520,
          maxWidth: "92vw",
          background: "#fff",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.32s cubic-bezier(.2,.8,.2,1)",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          borderLeft: `1px solid ${COLORS.hairline}`,
        }}
      >
        <div
          style={{
            padding: "24px 28px",
            borderBottom: `1px solid ${COLORS.hairline}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              className="uppercase text-muted"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Project escalations · {new Date().getFullYear()}
            </div>
            <div
              className="font-sans text-ink mt-2"
              style={{ fontSize: 38, letterSpacing: "-0.02em", lineHeight: 1.05 }}
            >
              {escalations.length} of {ESCALATION_YEARLY_MAX}
            </div>
            <div className="text-muted mt-1" style={{ fontSize: 11 }}>
              Director: {director.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer bg-transparent text-ink"
            style={{
              width: 32,
              height: 32,
              border: `1px solid ${COLORS.hairline}`,
              fontSize: 14,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "20px 28px",
            borderBottom: `1px solid ${COLORS.hairline}`,
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            {Array.from({ length: ESCALATION_YEARLY_MAX }).map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 6,
                  background:
                    i < escalations.length ? COLORS.tangerine : COLORS.gray01,
                }}
              />
            ))}
          </div>
          <div className="text-muted mt-2.5" style={{ fontSize: 11 }}>
            {remaining} escalation slot{remaining !== 1 ? "s" : ""} remaining this year
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {Object.entries(byTeam).map(([teamName, list]) => (
            <div key={teamName}>
              <div
                className="uppercase text-ink flex justify-between items-center"
                style={{
                  padding: "14px 28px",
                  background: COLORS.subtleBg,
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  borderBottom: `1px solid ${COLORS.hairline}`,
                }}
              >
                <span>{teamName}</span>
                <span className="text-muted">{list.length}</span>
              </div>
              {list.map((e) => (
                <div
                  key={e.id}
                  style={{
                    padding: "20px 28px",
                    borderBottom: `1px solid ${COLORS.hairline}`,
                  }}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <div
                        className="font-sans text-ink"
                        style={{
                          fontSize: 22,
                          letterSpacing: "-0.01em",
                          lineHeight: 1.15,
                        }}
                      >
                        {e.project}
                      </div>
                      <div className="text-muted mt-1" style={{ fontSize: 11 }}>
                        Opened {e.opened} · {e.quarter} · severity {e.severity}
                      </div>
                    </div>
                  </div>
                  <p
                    className="text-inkSoft mt-3"
                    style={{ fontSize: 12, lineHeight: 1.5 }}
                  >
                    {e.reason}
                  </p>
                  <div style={{ marginTop: 14, display: "flex", gap: 16 }}>
                    <a
                      href="https://admindagency.scoro.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline text-ink"
                      style={{
                        fontSize: 11,
                        borderBottom: `1px solid ${COLORS.ink}`,
                        paddingBottom: 2,
                        letterSpacing: "0.02em",
                      }}
                    >
                      Open in Scoro ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {escalations.length === 0 && (
            <div style={{ padding: "80px 28px", textAlign: "center" }}>
              <div
                className="font-sans text-ink"
                style={{ fontSize: 32, letterSpacing: "-0.02em" }}
              >
                Zero escalations
              </div>
              <div className="text-muted mt-2" style={{ fontSize: 12 }}>
                All projects tracking within tolerance.
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
