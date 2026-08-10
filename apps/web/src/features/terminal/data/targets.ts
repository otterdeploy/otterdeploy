import type { Collection } from "@tanstack/db";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
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

const terminalContainersQueryOptions = queryCollectionOptions({
  // Stable id, required for SQLite persistence to round-trip (see
  // projectCollection in features/projects/data/project.ts).
  id: "terminal-targets-containers",
  ...orpc.terminal.targets.queryOptions(),
  queryKey: [...TARGETS_QUERY_KEY, "containers"],
  queryFn: async () => fetchTargets(),
  queryClient,
  // Widened key type keeps both createCollection branches at the same TKey.
  // Collection is invariant in it, so the annotation below needs an exact match.
  getKey: (c): string | number => c.containerId,
  // Wrap so the collection sees `containers[]` as its rows; cluster /
  // databases come from the sibling collection below.
  select: (full: Awaited<ReturnType<typeof orpc.terminal.targets.call>>) => full.containers,
});

type TerminalContainerRow = Awaited<
  ReturnType<typeof orpc.terminal.targets.call>
>["containers"][number];

// Two-branch createCollection + pinned generics: same type gymnastics as
// projectCollection (features/projects/data/project.ts). The explicit
// annotation collapses the two branches' differing Collection instantiations
// so `useLiveQuery(() => collection)` can infer the row type.
export const terminalContainersCollection: Collection<TerminalContainerRow, string | number> =
  persistence
    ? createCollection(
        persistedCollectionOptions<TerminalContainerRow, string | number>({
          ...terminalContainersQueryOptions,
          persistence,
          schemaVersion: 1,
        }),
      )
    : createCollection(terminalContainersQueryOptions);

const terminalDatabasesQueryOptions = queryCollectionOptions({
  // Stable id, required for SQLite persistence to round-trip.
  id: "terminal-targets-databases",
  ...orpc.terminal.targets.queryOptions(),
  queryKey: [...TARGETS_QUERY_KEY, "databases"],
  queryFn: async () => fetchTargets(),
  queryClient,
  // Widened for the same TKey-invariance reason as the containers collection.
  getKey: (db): string | number => db.resourceId,
  select: (full: Awaited<ReturnType<typeof orpc.terminal.targets.call>>) => full.databases,
});

type TerminalDatabaseRow = Awaited<
  ReturnType<typeof orpc.terminal.targets.call>
>["databases"][number];

export const terminalDatabasesCollection: Collection<TerminalDatabaseRow, string | number> =
  persistence
    ? createCollection(
        persistedCollectionOptions<TerminalDatabaseRow, string | number>({
          ...terminalDatabasesQueryOptions,
          persistence,
          schemaVersion: 1,
        }),
      )
    : createCollection(terminalDatabasesQueryOptions);
