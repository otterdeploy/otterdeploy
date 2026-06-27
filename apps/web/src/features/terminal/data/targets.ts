import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Org-wide exec targets for the in-app terminal picker. Two collections
 * share the same underlying terminal.targets RPC — tanstack-query dedupes
 * by queryKey so opening the picker fires one network call regardless of
 * how many collections subscribe.
 *
 * Sync reads make re-opening the picker instant once the data is cached.
 */
const TARGETS_QUERY_KEY = orpc.terminal.targets.queryKey();

export const terminalContainersCollection = createCollection(
  queryCollectionOptions({
    ...orpc.terminal.targets.queryOptions(),
    queryKey: TARGETS_QUERY_KEY,
    queryFn: async () => orpc.terminal.targets.call(),
    queryClient,
    getKey: (c) => c.containerId,
    // Wrap so the collection sees `containers[]` as its rows; cluster /
    // databases come from the sibling collection below.
    select: (full: Awaited<ReturnType<typeof orpc.terminal.targets.call>>) => full.containers,
  }),
);

export const terminalDatabasesCollection = createCollection(
  queryCollectionOptions({
    ...orpc.terminal.targets.queryOptions(),
    queryKey: TARGETS_QUERY_KEY,
    queryFn: async () => orpc.terminal.targets.call(),
    queryClient,
    getKey: (db) => db.resourceId,
    select: (full: Awaited<ReturnType<typeof orpc.terminal.targets.call>>) => full.databases,
  }),
);
