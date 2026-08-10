import "server-only";

import { scoroPost } from "./scoro-api";

/** Proxy helper for `/api/scoro/*` — merges client JSON with server auth. */
export async function scoroFetch<T = unknown>(
  endpoint: string,
  clientBody: Record<string, unknown> = {}
): Promise<T | null> {
  const res = await scoroPost<T>(endpoint.replace(/^\//, ""), clientBody);
  if (!res) return null;
  return res as T;
}
