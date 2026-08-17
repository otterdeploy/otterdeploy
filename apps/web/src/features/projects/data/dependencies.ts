import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { parseCol, projectIdSchema } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Resource dependency edges (derived from `${{<Resource>.<VAR>}}` refs in
 * service env vars), one row per directed edge, keyed by "source->target" so
 * React Flow's edge id matches the collection key naturally.
 *
 * Single shared collection rather than one-per-project: consumers scope it by
 * adding `eq(d.projectId, …)` to their live query. TanStack DB forwards that
 * filter as `loadSubsetOptions`, from which `queryKey` / `queryFn` recover the
 * `projectId` to fetch (and cache) the right subset.
 */
/** Namespace prefix for the dependency-edges collection: the single source of
 *  truth manifest apply + the project event stream invalidate to redraw graph
 *  edges. See [[RESOURCE_COLLECTION_KEY]]. */
export const DEPENDENCIES_COLLECTION_KEY = ["dependencies"] as const;

/**
 * Warm one project subset's cache entry (route-loader intent-preload). Mirrors
 * the collection's own subset `queryKey`/`queryFn` below, so a warm entry makes
 * the collection's first load instant. Non-blocking + best-effort.
 */
export function prefetchDependencySubset(projectId: string): void {
  void queryClient
    .prefetchQuery({
      queryKey: [
        ...DEPENDENCIES_COLLECTION_KEY,
        ...orpc.project.dependencies.queryKey({ input: { projectId } }),
      ],
      queryFn: () => orpc.project.dependencies.call({ projectId }),
    })
    .catch(() => undefined);
}

const dependenciesQueryOptions = queryCollectionOptions({
  // Stable id so the OPFS-backed SQLite table survives page loads. See
  // projectCollection for why persistence never round-trips without one.
  id: "dependencies",
  syncMode: "on-demand",
  queryKey: (opts) => {
    const baseQuery = [...DEPENDENCIES_COLLECTION_KEY];
    const { filters } = parseLoadSubsetOptions(opts);

    if (!filters.at(0)) return baseQuery;

    const projectId = parseCol(projectIdSchema, filters, "projectId");
    const queryKey = orpc.project.dependencies.queryKey({
      input: { projectId },
    });
    return [...baseQuery, ...queryKey];
  },
  queryFn: async (ctx) => {
    const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);

    const projectId = parseCol(projectIdSchema, filters, "projectId");
    return orpc.project.dependencies.call({ projectId });
  },
  queryClient,
  getKey: (e) => `${e.source}->${e.target}`,
});

type DependencyRow = Awaited<ReturnType<typeof orpc.project.dependencies.call>>[number];

// Two-branch createCollection + pinned generics: see projectCollection for why.
export const dependenciesCollection = persistence
  ? createCollection(
      persistedCollectionOptions<DependencyRow, string | number>({
        ...dependenciesQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(dependenciesQueryOptions);
