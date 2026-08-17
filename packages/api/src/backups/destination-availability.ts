import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupDestination } from "@otterdeploy/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/** Keep active and degraded destinations while preserving the requested order. */
export function runnableDestinationIds(
  ids: BackupDestinationId[],
  rows: { id: BackupDestinationId; status: string }[],
): BackupDestinationId[] {
  const statusById = new Map(rows.map((row) => [row.id, row.status]));
  return ids.filter((id) => {
    const status = statusById.get(id);
    return status !== undefined && status !== "disabled";
  });
}

/** Resolve runnable destinations within the owning organization. */
export async function activeDestinationIdsFor(
  organizationId: OrganizationId,
  ids: BackupDestinationId[],
): Promise<BackupDestinationId[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: backupDestination.id, status: backupDestination.status })
    .from(backupDestination)
    .where(
      and(eq(backupDestination.organizationId, organizationId), inArray(backupDestination.id, ids)),
    );
  return runnableDestinationIds(ids, rows);
}
