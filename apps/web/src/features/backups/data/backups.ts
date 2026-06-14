import type { backupSchema } from "@otterdeploy/api/routers/backups/contract";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { z } from "zod";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Org-scoped backup runs. The list endpoint derives the org from the session,
 * so this is a plain (non-subset) collection — fetch the full list, filter
 * client-side in the route. The row type is inferred from the contract's
 * `backupSchema`, not re-declared.
 *
 * The contract has no create/delete for individual runs: a run is enqueued via
 * `backups.run` and removed only by retention. So this collection is read-only;
 * `runBackup` / `restoreBackup` are one-shot actions that refetch the list.
 */
export type Backup = z.infer<typeof backupSchema>;

/** Stable key shared by the collection fetch and the action invalidations. */
const backupsListKey = orpc.backups.list.queryKey({ input: {} });

export const backupsCollection = createCollection(
  queryCollectionOptions({
    ...orpc.backups.list.queryOptions({ input: {} }),
    queryKey: backupsListKey,
    queryFn: async () => orpc.backups.list.call({}),
    queryClient,
    getKey: (b) => b.id,
  }),
);

/** Enqueue + execute a manual "backup now" run, then refresh the list. */
export async function runBackup(
  input: Parameters<typeof orpc.backups.run.call>[0],
) {
  const res = await orpc.backups.run.call(input);
  await queryClient.invalidateQueries({ queryKey: backupsListKey });
  return res;
}

/** Restore a succeeded backup (download bytes as base64, or in-place). */
export function restoreBackup(
  input: Parameters<typeof orpc.backups.restore.call>[0],
) {
  return orpc.backups.restore.call(input);
}
