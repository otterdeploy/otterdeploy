import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupDestination } from "@otterdeploy/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Keep the destinations a backup may actually be written to, in the order
 * they were requested.
 *
 * Two independent gates. `usedForBackups` asks whether this row is a backup
 * destination at all — a bucket connected in the workbench is stored as one
 * of these rows but was never offered for backups, and must not become a
 * target because someone pasted its id. `status` is the operator's intent
 * about a row that IS one; `degraded` still runs, because that is a health
 * signal rather than a decision.
 */
export function runnableDestinationIds(
  ids: BackupDestinationId[],
  rows: { id: BackupDestinationId; status: string; usedForBackups: boolean }[],
): BackupDestinationId[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.filter((id) => {
    const row = byId.get(id);
    return row !== undefined && row.usedForBackups && row.status !== "disabled";
  });
}

/** Resolve runnable destinations within the owning organization. */
export async function activeDestinationIdsFor(
  organizationId: OrganizationId,
  ids: BackupDestinationId[],
): Promise<BackupDestinationId[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: backupDestination.id,
      status: backupDestination.status,
      usedForBackups: backupDestination.usedForBackups,
    })
    .from(backupDestination)
    .where(
      and(eq(backupDestination.organizationId, organizationId), inArray(backupDestination.id, ids)),
    );
  return runnableDestinationIds(ids, rows);
}
