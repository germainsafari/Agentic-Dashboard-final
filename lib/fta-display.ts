/** Normalize team codes so `01` and `1` match mapping keys like `"1"`. */
export function normalizeTeamCode(code: string): string {
  const c = code.trim().toLowerCase();
  if (/^\d+$/.test(c)) return String(parseInt(c, 10));
  return c;
}

export function isFtaLiveForTeam(teamCode: string, enabledCodes: string[]): boolean {
  if (enabledCodes.length === 0) return true;
  const normalized = normalizeTeamCode(teamCode);
  return enabledCodes.some((c) => normalizeTeamCode(c) === normalized);
}

/** Grey FTA only when an allowlist is set and this team is not on it. */
export function isFtaMutedForTeam(teamCode: string, enabledCodes: string[]): boolean {
  return !isFtaLiveForTeam(teamCode, enabledCodes);
}
