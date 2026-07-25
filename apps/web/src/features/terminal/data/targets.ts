import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Org-wide exec targets for the in-app terminal picker. Two collections
 * share the same underlying terminal.targets RPC but MUST NOT share a
 * react-query queryKey: two QueryCollections observing one cache entry
 * desync query-db-collection's per-collection refcounts (the recurring
 * `[cleanupQueryIfIdle] Invariant violation: refcount=1 but no listeners`
 * console warning). Each collection gets its own key; `fetchTargets`
 * dedupes concurrent network calls so opening the picker still fires one
 * request.
 *
 * Sync reads make re-opening the picker instant once the data is cached.
 */
const TARGETS_QUERY_KEY = orpc.terminal.targets.queryKey();

/** In-flight dedupe: both collections refetching at once share one RPC call. */
let inflight: ReturnType<typeof orpc.terminal.targets.call> | null = null;
async function fetchTargets() {
  if (!inflight) {
    inflight = orpc.terminal.targets.call();
    void inflight.finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export const terminalContainersCollection = createCollection(
  queryCollectionOptions({
    ...orpc.terminal.targets.queryOptions(),
    queryKey: [...TARGETS_QUERY_KEY, "containers"],
    queryFn: async () => fetchTargets(),
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
    queryKey: [...TARGETS_QUERY_KEY, "databases"],
    queryFn: async () => fetchTargets(),
    queryClient,
    getKey: (db) => db.resourceId,
    select: (full: Awaited<ReturnType<typeof orpc.terminal.targets.call>>) => full.databases,
  }),
);
