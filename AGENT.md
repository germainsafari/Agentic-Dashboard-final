# AGENT.md — Admind · Agentic Creative Director Dashboard

Single source of truth for any agent (human or AI) building, extending, or maintaining this product.
Read this file **top to bottom before touching code**. All decisions below are binding.

---

## 1. Product goal (one sentence)

A director / group-lead operational dashboard that turns Scoro data + an LLM agent into a quarterly KPI command centre for Admind's 9 dashboard users, strictly on-brand with Admind's visual and editorial system.

## 2. Audience - 9 directors and group leads, no one else

Routes are bound 1:1 to these users. Everything else in the org is ignored.

| id | Name | Role | Email | Teams they own (via `upper_leader_email`) |
|---|---|---|---|---|
| `piotr` | Piotr Wiśniewski | Creative Director | `piotr.wisniewski@admindagency.com` | `CAMPAIGNS`, `COPYWRITER`, `FE`, `UBS-SYN` |
| `marta` | Marta Szmyd | Creative Director | `marta.szmyd@admindagency.com` | `1`, `2`, `4`, `COE` |
| `dominika` | Dominika Konieczkowska-Kracik | Creative Director | `dominika.konieczkowska@admindagency.com` | `PRINC` |
| `michal` | Michał Majewski | Creative Director | `michal.majewski@admindagency.com` | `3D`, `ACC`, `MO - MAJA`, `MO - MO` |
| `karolina` | Karolina Pospischil | Strategy Director | `karolina.pospischil@admind.pl` | `STR` |
| `jonattas` | Jonattas Poltronieri | CT Director | `jonattas.poltronieri@admindagency.com` | `CT`, `UX` |
| `krzysztof` | Krzysztof Wroblewski | Group Lead | `krzysztof.wroblewski@admindagency.com` | `DP & BP`, `PM-DP` |
| `maciej` | Maciej Furtak | Group Lead | `maciej.furtak@admindagency.com` | `PPT`, `PM-PPT` |
| `justyna` | Justyna Dorman | Group Lead | `justyna.dorman@admindagency.com` | `BA`, `UBS_BA` |

**Team members derivation** (from `mapping_ba_update.json`):
1. Filter `members` where `members[].team` matches one of the director's teams.
2. Apply `special_rules`:
   - **Exclude** anyone in `special_rules.excluded_people`.
   - **Regroup** `justyna.dorman@admindagency.com` under `aleksandra.golab@admindagency.com` regardless of other signals when resolving member rosters. Her own group-lead dashboard still uses teams where she is the configured team leader.
3. Team leads come from `team_leader_lookup[team].leader_email`.

## 3. Metrics — 6 KPIs exactly (from `Agentic dashboard metrics.md`)

Aggregation is **quarterly per team** unless stated. A team "achieves" a KPI when `value >= target`.

| Key | Label | Target | Type | Source logic (Scoro) |
|---|---|---|---|---|
| `utilization` | Project Utilization | ≥ 75 % | donut | Time entries per team, Budget Type ∈ {CE, OP, BM, RET}, exclude Internal (non-billable). Denominator = total available hours from Scoro (minus time off). |
| `billable` | Billable Hours | ≥ 65 % | bar | % of tracked hours billed to clients. Reuse Scoro billability report; CD version. |
| `fta` | First-Time Acceptance Rate | ≥ 15 %* | bar | Projects tagged `FTA` delivered within ≤ 2 feedback rounds ÷ all team projects. |
| `estimate` | Projects in Estimate | ≥ 80 % | bar | Projects with status ∈ {Completed, Invoiced} where `budget_cost ≥ actual_cost` at project level. |
| `newBizWin` | New Business Pitch Win Rate | ≥ 30 % | bar | Projects tagged `Pitch`, Budget Type = `New Business`, status ∈ {Completed, Invoiced} ÷ all Pitch+NewBusiness projects. |
| `existingWin` | Existing Client Pitch Win Rate | ≥ 60 % | bar | Projects tagged `Pitch`, Budget Type ∈ {CE, OP, BM, RET}, status ∈ {Completed, Invoiced} ÷ all Pitch+{CE,OP,BM,RET} projects. |

Plus two signals surfaced in the header, not in the grid:
- **Major Escalations** — count of projects with `Escalation` tag per year, target **≤ 2** (hard cap shown as `N / 4 max` because the Figma uses 4-slot allowance).
- **KPI Achievement Score** — `# KPIs achieved across all teams of this director ÷ total`. Cumulative: Q3 view = Q1+Q2+Q3. Shown as e.g. `5 / 6`.

*FTA target is TBD with Ola; default 15 % unchanged until confirmed.

## 4. Brand system — non-negotiable

Inherit the visual language already present in `Dashboard.html`. Do **not** substitute fonts, colors, or layout rhythm.

### 4.1 Colour tokens
```
ink        #0A0A0A    body text, rules
inkSoft    #3A3A3A
muted      #5A5A5A    captions, meta
hairline   #1A1A1A    all dividers, 1px
paper      #FFFFFF    card surface
subtleBg   #F6F4EF    app background & hover
beige      #EBDBC3
peach      #F1D8BF    hero header background
tangerine  #FF5A3C    brand accent / off-track / escalation
turquoise  #00DDC2    achieved / live indicator
gray01     #D9D9D9
gray02     #5A5A5A
gray03     #B0B0B0
```

Rules:
- Achieved KPI → `turquoise`.
- Off-track → `tangerine`.
- On-track (≥ 75 % of goal, below goal) → neutral `#8A8A8A`.
- Only **one** tangerine element per viewport section when possible (reserved for escalation / alert).

### 4.2 Typography
- Primary family: `"Acumin Pro"` (Adobe). Fallback stack: `"acumin-pro", "Source Sans 3", "Helvetica Neue", Helvetica, Arial, sans-serif`.
- Do not introduce serif display faces.
- Display numbers (KPI values, director name, quarter) use `letter-spacing: -0.02em` and `font-weight: 400`.
- All-caps labels: `font-size: 10–11px`, `letter-spacing: 0.12–0.18em`, `color: muted`.
- Numeric: `font-variant-numeric: tabular-nums`.

### 4.3 Layout grammar
- Dividers: **1 px solid `hairline`**. Never drop shadows except the page container (`0 0 40px rgba(0,0,0,0.04)`).
- No border radius. Everything is square.
- Page container max width `1680px`, centered on `#fff`.
- Section padding: `0 48px`.
- Hero header background: `peach` (`#F1D8BF`).
- Quarter bar background: `ink` (`#0A0A0A`) with white active tab.

### 4.4 Components must exist (naming is final)
`Donut`, `GoalBar`, `QuarterSpark`, `TeamHeader`, `KpiTooltip`, `Header` (CD identity + achievement ring + escalation tile), `QuarterBar`, `LayoutRows`, `LayoutCards`, `EscalationPanel` (right drawer), `TeamDrilldown` (centered modal).

### 4.5 Interaction language
- Hover on KPI cell: background → `subtleBg`, reveal `KpiTooltip` with Q1–Q4 sparkline.
- Click team name → `TeamDrilldown`. Click escalation dot/pill → same drilldown with escalation focus banner.
- Live indicator: 7 px turquoise dot pulsing 2 s.
- Keyboard: `1/2/3/4` switches quarter.
- Layout is `Rows` on ≥ 1281 px, `Cards` below.

## 5. Tech stack (fixed)

- Runtime: **Node.js 20**
- Framework: **Next.js 14** (App Router) + **React 18** + **TypeScript 5**
- Styling: **Tailwind CSS 3** with brand tokens in `tailwind.config.ts`
- Data: **Scoro REST** (`COMPANY_BASE_URL`) + **Scoro MCP** (`SCORO_MCP`), server-only calls
- Agent: **Google Gemini** (`GOOGLE_GEMINI_API_KEY`) via `@google/generative-ai`, server-side only
- Validation: **Zod**
- No client-side secrets, no Redux, no UI library. Raw React + Tailwind only.

## 6. File structure

```
/
├── AGENT.md                     ← this file
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── .env                         ← already present (do not commit)
├── mapping_ba_update.json       ← input data (read-only at runtime)
├── Agentic dashboard metrics.md ← spec
├── Dashboard.html               ← visual reference only
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                 ← director picker
│   ├── dashboard/[directorId]/page.tsx
│   └── api/
│       ├── kpis/[directorId]/route.ts
│       ├── escalations/[directorId]/route.ts
│       ├── scoro/[...path]/route.ts
│       └── agent/insights/route.ts
├── components/
│   ├── ui/{Donut,GoalBar,QuarterSpark}.tsx
│   └── dashboard/{Header,QuarterBar,LayoutRows,LayoutCards,
│                   TeamHeader,KpiTooltip,EscalationPanel,
│                   TeamDrilldown,Footer,DirectorCard}.tsx
└── lib/
    ├── brand.ts                 ← colour + KPI meta constants
    ├── directors.ts             ← hardcoded 9 dashboard users + team resolver
    ├── mapping.ts               ← loads mapping_ba_update.json
    ├── kpi.ts                   ← buildSnapshot — Scoro live or fallback zeros
    ├── scoro-api.ts             ← correct Scoro v2 POST envelope + pagination
    ├── scoro-live.ts            ← users, time entries, projects → KPI aggregates
    ├── scoro.ts                 ← scoroFetch for /api/scoro proxy
    ├── gemini.ts                ← Gemini client + prompts
    └── mock.ts                  ← fallback zeros when Scoro unavailable
```

## 7. Data flow

**Current behaviour:** `buildSnapshot()` loads all Scoro users once, resolves each team member’s `user_id`, then pulls **time entries** (full `KPI_YEAR`, filtered by `time_entry_date`) and **projects** (`projects/list` + `bookmark_users` + `detailed_response`, paginated). KPIs are derived in `lib/scoro-live.ts`. If the API or email matching fails, the team falls back to `lib/mock.ts` (zeros). Roster still comes from `mapping_ba_update.json`. **Refresh:** on each server request only (no polling). See `README.md` for field-level KPI mapping.

```
Browser → /dashboard/[directorId]
           │
           └─→ buildSnapshot(director, quarter)
                 ├─→ scoro-live (users + timeEntries + projects) → KPI grid
                 ├─→ mock.ts (per-team fallback)
                 └─→ POST /api/agent/insights → lib/gemini.ts
```

Environment variables (already in `.env`):

```
COMPANY_BASE_URL=https://admindagency.scoro.com/api/v2
SCORO_API_KEY=***
SCORO_COMPANY_ACCOUNT_ID=admindagency   # optional; parsed from URL if omitted
KPI_YEAR=2026                           # optional
SCORO_MCP=https://admindagency.scoro.com/mcp
GOOGLE_GEMINI_API_KEY=***
```

All four are **server-side only**. Never expose any of them to the client, never prefix with `NEXT_PUBLIC_`.

## 8. Scoro query contract (lib/scoro.ts)

Minimum surface area the client must expose (everything returns JSON):

```ts
getTimeEntries({ team, quarter, budgetTypes, excludeActivityGroups })
getProjects({ team, statuses, tags, budgetTypes, quarter })
getAvailableHours({ team, quarter })
```

Internally POST to `${COMPANY_BASE_URL}/...` with body:
```json
{ "lang": "eng", "apiKey": "${SCORO_API_KEY}", "company_account_id": "admindagency", "filter": { ... } }
```

All requests timeout at 10 s, cache for 5 min (`next: { revalidate: 300 }`), and are funnelled through a single `scoroFetch()` helper that logs failures and returns `null` so the caller can fall back to mock.

## 9. KPI computation (lib/kpi.ts)

One pure function per KPI, signature:
```ts
computeUtilization(timeEntries, availableHours): number   // 0..100
computeBillable(timeEntries): number
computeFTA(projects): number
computeEstimate(projects): number
computeNewBizWin(projects): number
computeExistingWin(projects): number
```

Assembler `buildTeamKpis(team, quarter)` returns:
```ts
{
  [kpiKey]: { Q1:number, Q2:number, Q3:number, Q4:number },
  projectsAnalyzed: { fta, newBizWin, existingWin }
}
```

## 10. Gemini agent (lib/gemini.ts)

Model: `gemini-1.5-flash` (cheap, fast) for inline insights; `gemini-1.5-pro` reserved for drilldown summaries.

Prompt template (strict):
```
You are an Admind operations analyst briefing a Creative Director.
Team: {team.name} · Director: {director.name}
KPI: {meta.label} (goal {meta.goal}%)
Quarterly values: Q1={q1}% Q2={q2}% Q3={q3}% Q4={q4}%
Write ONE paragraph (≤ 45 words):
- state the trend
- name the single biggest risk or win
- suggest one concrete next action
No bullet lists. No emojis. No preamble.
```

Response capped at 60 tokens. Never forwarded raw to the client until sanitised.

## 11. Build checklist (execute in order)

1. `npm init -y` in workspace root.
2. Install deps:
   `npm i next react react-dom zod @google/generative-ai`
   `npm i -D typescript @types/react @types/react-dom @types/node tailwindcss postcss autoprefixer`
3. `npx tailwindcss init -p` — then overwrite `tailwind.config.ts` with brand tokens.
4. Create `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`.
5. Implement `lib/brand.ts`, `lib/directors.ts`, `lib/mapping.ts`, `lib/mock.ts` in that order (no external calls yet).
6. Implement UI primitives: `Donut`, `GoalBar`, `QuarterSpark`.
7. Implement dashboard shell: `Header`, `QuarterBar`, `LayoutRows`, `LayoutCards`, `TeamHeader`, `KpiTooltip`, `EscalationPanel`, `TeamDrilldown`.
8. Wire `/` director picker and `/dashboard/[directorId]` page (server component, mock data).
9. Implement `lib/scoro.ts` + API routes with mock fallback.
10. Implement `lib/gemini.ts` + `/api/agent/insights`.
11. `npm run dev`, verify all 6 director routes render.

## 12. Done definition

- Every director route renders: live Scoro KPIs when keys + user match succeed; otherwise zero fallback per team.
- Tailwind build contains zero arbitrary colours outside the brand token set.
- `Dashboard.html` and the live app are visually indistinguishable at 1440 px.
- `/api/agent/insights` returns a 45-word briefing in ≤ 3 s.
- No secret key reaches the browser bundle (verified via `next build` output).

## 13. Out of scope (do not build)

- Authentication (access is IP/email-gated at reverse proxy in production).
- Writing to Scoro.
- Non-director personas.
- Mobile < 720 px.
- i18n. Copy is English-only.
