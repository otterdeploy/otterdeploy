import { createCollection } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";

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
/** Namespace prefix for the dependency-edges collection — the single source of
 *  truth manifest apply + the project event stream invalidate to redraw graph
 *  edges. See [[RESOURCE_COLLECTION_KEY]]. */
export const DEPENDENCIES_COLLECTION_KEY = ["dependencies"] as const;

export const dependenciesCollection = createCollection(
  queryCollectionOptions({
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
  }),
);
