import type { scheduleSchema } from "@otterdeploy/api/routers/backups/contract";
import type { z } from "zod";

import { omitUndefined } from "@otterdeploy/shared/object";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Recurring backup schedules for the active org. List/CRUD ride the
 * collection's own handlers; the page reads via a live query and mutates the
 * collection. The row type is inferred from the contract.
 *
 * The create/update inputs accept only a subset of the row's columns (name,
 * sources, cron, destination, keepDaily, retentionDays, encryption, enabled);
 * server-managed fields (run history, next run, the other retention tiers)
 * come back on refetch.
 */
export type Schedule = z.infer<typeof scheduleSchema>;

const schedulesListKey = orpc.backups.schedules.list.queryKey();

const schedulesQueryOptions = queryCollectionOptions({
  // Stable id: persistedCollectionOptions keys the SQLite table off it; a
  // random per-load id would never round-trip (see project.ts).
  id: "backup-schedules",
  ...orpc.backups.schedules.list.queryOptions(),
  queryKey: schedulesListKey,
  queryFn: async () => orpc.backups.schedules.list.call({}),
  onInsert: async ({ transaction }) => {
    await Promise.all(
      transaction.mutations.map(async (m) => {
        const row = m.modified;
        await orpc.backups.schedules.create.call({
          name: row.name,
          sources: row.sources,
          cron: row.cron,
          destinationIds: row.destinationIds,
          // Null/empty projectId means org-wide. Collapse to undefined so
          // omitUndefined drops the key entirely (input has no null form).
          ...omitUndefined({ projectId: row.projectId || undefined }),
          keepLast: row.keepLast,
          keepHourly: row.keepHourly,
          keepDaily: row.keepDaily,
          keepWeekly: row.keepWeekly,
          keepMonthly: row.keepMonthly,
          keepYearly: row.keepYearly,
          retentionDays: row.retentionDays,
          maxStorageGb: row.maxStorageGb,
          preHook: row.preHook,
          encryption: row.encryption === "none" ? "none" : "aes-256-gcm",
          enabled: row.enabled,
          maxRetries: row.maxRetries,
          verifyAfterBackup: row.verifyAfterBackup,
          overdueAfterHours: row.overdueAfterHours,
        });
        // Temp optimistic id → refetch for the real row.
        await queryClient.invalidateQueries({ queryKey: schedulesListKey });
      }),
    );
  },
  onUpdate: async ({ transaction }) => {
    await Promise.all(
      transaction.mutations.map((m) => {
        const c = m.changes;
        return orpc.backups.schedules.update.call({
          id: m.original.id,
          ...omitUndefined({
            name: c.name,
            sources: c.sources,
            cron: c.cron,
            keepLast: c.keepLast,
            keepHourly: c.keepHourly,
            keepDaily: c.keepDaily,
            keepWeekly: c.keepWeekly,
            keepMonthly: c.keepMonthly,
            keepYearly: c.keepYearly,
            retentionDays: c.retentionDays,
            maxStorageGb: c.maxStorageGb,
            preHook: c.preHook,
            enabled: c.enabled,
            maxRetries: c.maxRetries,
            verifyAfterBackup: c.verifyAfterBackup,
            overdueAfterHours: c.overdueAfterHours,
          }),
        });
      }),
    );
  },
  onDelete: async ({ transaction }) => {
    await Promise.all(
      transaction.mutations.map((m) => orpc.backups.schedules.delete.call({ id: m.original.id })),
    );
  },
  queryClient,
  getKey: (s) => s.id,
});

type ScheduleRow = Awaited<ReturnType<typeof orpc.backups.schedules.list.call>>[number];

// Call `createCollection` inside each branch. The persisted and plain option
// objects are different types (see project.ts for the full type note).
export const schedulesCollection = persistence
  ? createCollection(
      persistedCollectionOptions<ScheduleRow, string | number>({
        ...schedulesQueryOptions,
        persistence,
        // v2: rows grew keepLast/keepHourly + maxRetries/verifyAfterBackup/
        // overdueAfterHours (production-hardening pass).
        schemaVersion: 2,
      }),
    )
  : createCollection(schedulesQueryOptions);

/** Trigger a schedule's backups now; refresh the runs list once enqueued. */
export async function runSchedule(id: Schedule["id"]) {
  const res = await orpc.backups.schedules.run.call({ id });
  await queryClient.invalidateQueries({
    queryKey: orpc.backups.list.queryKey({ input: {} }),
  });
  return res;
}
