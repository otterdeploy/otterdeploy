import type { backupSchema } from "@otterdeploy/api/routers/backups/contract";
import type { z } from "zod";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Org-scoped backup runs. The list endpoint derives the org from the session,
 * so this is a plain (non-subset) collection. Fetch the full list, filter
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

/** A run that hasn't reached a terminal state yet, so the row will still change.
 *  Takes `unknown` and checks structurally: `refetchInterval` below reads the
 *  query's data without the collection's typing, and a real check beats a cast. */
function isInFlight(row: unknown): boolean {
  if (typeof row !== "object" || row === null || !("status" in row)) return false;
  return row.status === "queued" || row.status === "running";
}

const backupsQueryOptions = queryCollectionOptions({
  // Stable id: persistedCollectionOptions keys the SQLite table off it; a
  // random per-load id would never round-trip (see project.ts).
  id: "backups",
  ...orpc.backups.list.queryOptions({ input: {} }),
  queryKey: backupsListKey,
  queryFn: async () => orpc.backups.list.call({}),
  queryClient,
  getKey: (b) => b.id,
  // `backups.run` returns once the run is ENQUEUED, not once it finishes, so
  // runBackup's single invalidate below always lands on a still-running row.
  // Without this the row sat at "Running" forever. With the completed log
  // visible inside it, since logs are fetched separately, and Restore /
  // Download stayed disabled because both gate on status === "succeeded".
  // Poll only while something is in flight; stop dead once it settles.
  refetchInterval: (query) => {
    const data: unknown = query.state.data;
    return Array.isArray(data) && data.some(isInFlight) ? 2000 : false;
  },
});

type BackupRow = Awaited<ReturnType<typeof orpc.backups.list.call>>[number];

// Call `createCollection` inside each branch. The persisted and plain option
// objects are different types (see project.ts for the full type note).
export const backupsCollection = persistence
  ? createCollection(
      persistedCollectionOptions<BackupRow, string | number>({
        ...backupsQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(backupsQueryOptions);

/** Enqueue + execute a manual "backup now" run, then refresh the list. */
export async function runBackup(input: Parameters<typeof orpc.backups.run.call>[0]) {
  const res = await orpc.backups.run.call(input);
  await queryClient.invalidateQueries({ queryKey: backupsListKey });
  return res;
}

/** Restore a succeeded backup (download bytes as base64, or in-place). */
export function restoreBackup(input: Parameters<typeof orpc.backups.restore.call>[0]) {
  return orpc.backups.restore.call(input);
}

/** Integrity check result. The server re-fetches the stored archive and
 *  recomputes its checksum. Read through `useQuery` at the point of use (see
 *  restore-verify-step.tsx), so only the output type is shared from here. */
export type VerifyResult = Awaited<ReturnType<typeof orpc.backups.verify.call>>;
