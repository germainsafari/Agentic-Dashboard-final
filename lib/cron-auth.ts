import type { NextRequest } from "next/server";

/** When CRON_SECRET is set, require matching Bearer token on protected routes. */
export function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return true;
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}
