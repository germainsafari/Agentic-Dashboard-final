import Link from "next/link";
import { allResolvedDirectors } from "@/lib/directors";
import { COLORS } from "@/lib/brand";

export default function HomePage() {
  const directors = allResolvedDirectors();

  return (
    <div
      className="mx-auto bg-white shadow-page min-h-screen"
      style={{ maxWidth: 1680 }}
    >
      <header
        className="px-12 pt-10 pb-16"
        style={{
          background: COLORS.peach,
          borderBottom: `1px solid ${COLORS.hairline}`,
        }}
      >
        <div className="flex items-center gap-4 mb-10">
          <svg width="36" height="36" viewBox="0 0 78 78" fill="none">
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
            Admind <span className="text-muted">/ Agentic Dashboard</span>
          </div>
        </div>

        <h1
          className="font-sans text-ink m-0"
          style={{ fontSize: 72, lineHeight: 0.95, letterSpacing: "-0.035em" }}
        >
          Choose your dashboard.
        </h1>
        <p
          className="text-inkSoft mt-4 max-w-[680px]"
          style={{ fontSize: 16, lineHeight: 1.5 }}
        >
          Nine operational command centres. One per director or group lead. Quarterly KPIs live
          from Scoro, escalation tracking, and an on-call agent briefing — all
          wired to the Admind visual system.
        </p>
      </header>

      <div
        className="px-12 py-12"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 0,
          borderTop: `1px solid ${COLORS.hairline}`,
          borderLeft: `1px solid ${COLORS.hairline}`,
        }}
      >
        {directors.map((d) => (
          <Link
            key={d.id}
            href={`/dashboard/${d.id}`}
            className="no-underline text-ink"
            style={{
              borderRight: `1px solid ${COLORS.hairline}`,
              borderBottom: `1px solid ${COLORS.hairline}`,
              padding: 28,
              background: "#fff",
              display: "block",
              transition: "background 0.12s ease",
            }}
          >
            <div
              className="flex items-start justify-between gap-4 mb-8"
              style={{ minHeight: 44 }}
            >
              <div
                className="uppercase text-muted"
                style={{ fontSize: 10, letterSpacing: "0.16em" }}
              >
                {d.role}
              </div>
              <div
                className="flex items-center justify-center text-white"
                style={{
                  width: 44,
                  height: 44,
                  background: COLORS.ink,
                  fontSize: 14,
                  letterSpacing: "0.04em",
                }}
              >
                {d.initials}
              </div>
            </div>
            <div
              className="font-sans text-ink"
              style={{
                fontSize: 32,
                letterSpacing: "-0.025em",
                lineHeight: 1.05,
              }}
            >
              {d.name}
            </div>
            <div className="text-muted mt-2" style={{ fontSize: 12 }}>
              {d.peopleTotal} people · {d.teams.length} team
              {d.teams.length > 1 ? "s" : ""}
            </div>
            <div
              className="text-inkSoft mt-5 flex flex-wrap gap-1.5"
              style={{ fontSize: 11 }}
            >
              {d.teams.map((t) => (
                <span
                  key={t.code}
                  style={{
                    padding: "4px 8px",
                    border: `1px solid ${COLORS.hairline}`,
                    letterSpacing: "0.04em",
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
            <div
              className="uppercase text-ink mt-7"
              style={{
                fontSize: 11,
                letterSpacing: "0.12em",
                borderBottom: `1px solid ${COLORS.ink}`,
                paddingBottom: 3,
                display: "inline-block",
              }}
            >
              Open dashboard →
            </div>
          </Link>
        ))}
      </div>

      <footer
        className="px-12 py-4 flex justify-between uppercase text-muted"
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          borderTop: `1px solid ${COLORS.hairline}`,
        }}
      >
        <span>Admind · Agentic Dashboard · {new Date().getFullYear()}</span>
        <span>Directors & leads</span>
      </footer>
    </div>
  );
}
