import "server-only";

import { normalizeTeamCode } from "./fta-display";

/**
 * Comma-separated Scoro team codes (e.g. `1,2,events`) with FTA in full color.
 * Empty / unset = all teams (FTA live everywhere). Set to restrict color to listed teams only.
 */
export function getFtaEnabledTeamCodesFromEnv(): string[] {
  const raw = process.env.KPI_FTA_ENABLED_TEAMS ?? "";
  return raw
    .split(",")
    .map((s) => normalizeTeamCode(s))
    .filter(Boolean);
}
