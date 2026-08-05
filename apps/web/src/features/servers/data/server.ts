import type { serverSchema } from "@otterdeploy/api/routers/server/contract";
import type { z } from "zod";

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/** Single server row as returned by orpc.server.list / queried via the collection. */
export type Server = z.infer<typeof serverSchema>;

export const serverCollection = createCollection(
  queryCollectionOptions({
    ...orpc.server.list.queryOptions(),
    queryKey: orpc.server.list.queryKey(),
    queryFn: async () => orpc.server.list.call(),
    // This collection carries `status` and `provisionStatus` — the badge in the
    // servers table. Without a poll it only changed on a manual reload, so a
    // node going down (or a provision finishing) sat visibly wrong until the
    // operator happened to refresh. Servers change on the order of minutes,
    // the sidebar (which mounts this everywhere, so this poll is app-wide
    // ambient traffic) only renders a count, and an active provision has its
    // own fast poller (server-provision-progress) — 60s is plenty here.
    refetchInterval: 60_000,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.server.create.call({
            id: m.modified.id,
            name: m.modified.name,
            host: m.modified.host,
            region: m.modified.region ?? undefined,
            role: m.modified.role,
            cpuTotal: m.modified.cpuTotal,
            memTotalGb: m.modified.memTotalGb,
            diskTotalGb: m.modified.diskTotalGb ?? undefined,
            diskUnit: m.modified.diskUnit ?? undefined,
            daemonVersion: m.modified.daemonVersion ?? undefined,
            labels: m.modified.labels ?? undefined,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => orpc.server.delete.call({ id: m.original.id })),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);
