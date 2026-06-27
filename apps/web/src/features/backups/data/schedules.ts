import type { scheduleSchema } from "@otterdeploy/api/routers/backups/contract";
import type { z } from "zod";

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

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

export const schedulesCollection = createCollection(
  queryCollectionOptions({
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
            ...(row.projectId ? { projectId: row.projectId } : {}),
            keepDaily: row.keepDaily,
            keepWeekly: row.keepWeekly,
            keepMonthly: row.keepMonthly,
            keepYearly: row.keepYearly,
            retentionDays: row.retentionDays,
            maxStorageGb: row.maxStorageGb,
            preHook: row.preHook,
            encryption: row.encryption === "none" ? "none" : "aes-256-gcm",
            enabled: row.enabled,
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
            ...(c.name !== undefined && { name: c.name }),
            ...(c.sources !== undefined && { sources: c.sources }),
            ...(c.cron !== undefined && { cron: c.cron }),
            ...(c.keepDaily !== undefined && { keepDaily: c.keepDaily }),
            ...(c.keepWeekly !== undefined && { keepWeekly: c.keepWeekly }),
            ...(c.keepMonthly !== undefined && { keepMonthly: c.keepMonthly }),
            ...(c.keepYearly !== undefined && { keepYearly: c.keepYearly }),
            ...(c.retentionDays !== undefined && {
              retentionDays: c.retentionDays,
            }),
            ...(c.maxStorageGb !== undefined && {
              maxStorageGb: c.maxStorageGb,
            }),
            ...(c.preHook !== undefined && { preHook: c.preHook }),
            ...(c.enabled !== undefined && { enabled: c.enabled }),
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
  }),
);

/** Trigger a schedule's backups now; refresh the runs list once enqueued. */
export async function runSchedule(id: Schedule["id"]) {
  const res = await orpc.backups.schedules.run.call({ id });
  await queryClient.invalidateQueries({
    queryKey: orpc.backups.list.queryKey({ input: {} }),
  });
  return res;
}
