import type { serverSchema } from "@otterdeploy/api/routers/server/contract";
import type { z } from "zod";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/** Single server row as returned by orpc.server.list / queried via the collection. */
export type Server = z.infer<typeof serverSchema>;

const serverQueryOptions = queryCollectionOptions({
  // Stable id — keys the persisted SQLite table (see projectCollection).
  id: "servers",
  ...orpc.server.list.queryOptions(),
  queryKey: orpc.server.list.queryKey(),
  queryFn: async () => orpc.server.list.call(),
  // This collection carries `status` and `provisionStatus` — the badge in
  // the servers table. Every server-row write publishes a `servers` resync
  // over the org event stream (use-org-events refetches this collection),
  // so the poll is only a dead-stream backstop — and the sidebar mounts
  // this app-wide, so its cadence is ambient traffic on every page. An
  // active provision has its own fast poller (server-provision-progress).
  refetchInterval: 300_000,
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
});

type ServerRow = Awaited<ReturnType<typeof orpc.server.list.call>>[number];

// Two-branch createCollection with pinned generics — see projectCollection
// (features/projects/data/project.ts) for why the ternary can't be inlined.
export const serverCollection = persistence
  ? createCollection(
      persistedCollectionOptions<ServerRow, string | number>({
        ...serverQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(serverQueryOptions);
