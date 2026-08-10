import "server-only";

import { scoroListAllPages } from "./scoro-api";

export type ScoroActivityRow = {
  activity_id: number;
  name: string;
  parent_id: number;
  parent_name: string;
  is_group: number;
};

/** Scoro activity group — must match exactly (Rafal / work-report spec). */
export const INTERNAL_NON_BILLABLE_GROUP_NAME =
  "Internal activities (non billable)";

let _activityRows: ScoroActivityRow[] | null = null;
let _internalActivityIds: Set<number> | null = null;

export async function loadScoroActivityRows(): Promise<ScoroActivityRow[]> {
  if (_activityRows) return _activityRows;
  type Row = {
    activity_id?: number;
    name?: string;
    parent_id?: number;
    parent_name?: string;
    is_group?: number;
  };
  const rows = await scoroListAllPages<Row>("activities/list", { maxPages: 10 });
  _activityRows = rows
    .filter((r) => typeof r.activity_id === "number")
    .map((r) => ({
      activity_id: r.activity_id as number,
      name: String(r.name ?? ""),
      parent_id: Number(r.parent_id ?? 0),
      parent_name: String(r.parent_name ?? ""),
      is_group: Number(r.is_group ?? 0),
    }));
  return _activityRows;
}

/** All activity IDs under the named group (group row + descendants). */
export function internalNonBillableActivityIds(
  rows: ScoroActivityRow[],
  groupName = INTERNAL_NON_BILLABLE_GROUP_NAME
): Set<number> {
  const target = groupName.trim().toLowerCase();
  const group = rows.find(
    (r) => r.is_group === 1 && r.name.trim().toLowerCase() === target
  );
  if (!group) return new Set();

  const ids = new Set<number>([group.activity_id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.parent_id) && !ids.has(row.activity_id)) {
        ids.add(row.activity_id);
        changed = true;
      }
    }
  }
  return ids;
}

export async function loadInternalNonBillableActivityIds(): Promise<Set<number>> {
  if (_internalActivityIds) return _internalActivityIds;
  const rows = await loadScoroActivityRows();
  _internalActivityIds = internalNonBillableActivityIds(rows);
  if (_internalActivityIds.size === 0) {
    console.warn(
      `[activities] Group "${INTERNAL_NON_BILLABLE_GROUP_NAME}" not found — internal activity filter disabled`
    );
  } else {
    console.log(
      `[activities] Internal non-billable group: ${_internalActivityIds.size} activity id(s)`
    );
  }
  return _internalActivityIds;
}

export function clearScoroActivityCaches(): void {
  _activityRows = null;
  _internalActivityIds = null;
}

export function activityIdFromEntry(entry: {
  activity_id?: unknown;
}): number | null {
  const id = Number(entry.activity_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function isInternalNonBillableActivityId(
  activityId: number | null,
  internalIds: Set<number>
): boolean {
  if (activityId == null || internalIds.size === 0) return false;
  return internalIds.has(activityId);
}
