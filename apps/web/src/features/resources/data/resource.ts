import { zId } from "@otterdeploy/shared/id";
import { createCollection, type SimpleComparison } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import { z } from "zod";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * All resources (databases + services + …) for the active project, sourced
 * from `project.resource.list` (a discriminated union over `type`).
 *
 * Single shared collection rather than one-per-project: consumers scope it by
 * adding `eq(r.projectId, …)` to their live query. TanStack DB forwards that
 * filter as `loadSubsetOptions`, from which `queryKey` / `queryFn` recover the
 * `projectId` to fetch (and cache) the right subset.
 */
function parseCol<T extends z.ZodType>(
  schema: T,
  filters: SimpleComparison[],
  field = "id",
): z.infer<T> {
  // `field` is a path array (e.g. ["projectId"] or ["r","projectId"]) shared by
  // reference with the live-query's where-expression — read the leaf with
  // .at(-1), never mutate.
  const expr = filters.find((f) => f.field.at(-1) === field);
  if (!expr) throw new Error(`${field} is required`);
  return schema.parse(expr.value);
}

const projectIdSchema = zId("project");

/**
 * Namespace prefix for the on-demand resource collection's react-query cache
 * entries. Deliberately distinct from the `orpc.project.resource.list` key so
 * the collection's polled subset queries don't collide with direct one-shot
 * `project.resource.list` reads. Exported as the single source of truth: any
 * code that needs to refetch the graph invalidates THIS, instead of re-typing
 * the `["resource"]` literal (which drifts silently if the prefix ever changes).
 */
export const RESOURCE_COLLECTION_KEY = ["resource"] as const;

export const resourceCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = [...RESOURCE_COLLECTION_KEY];
      const { filters } = parseLoadSubsetOptions(opts);
      // Startup base-key call: query-db-collection calls queryKey({}) once to
      // compute the prefix every subset key must extend. No filters yet — just
      // return the prefix.
      if (!filters.at(0)) return baseQuery;
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const subsetKey = orpc.project.resource.list.queryKey({
        input: { projectId },
      });

      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      return orpc.project.resource.list.call({ projectId });
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          return orpc.project.resource.delete.call({
            projectId: m.original.projectId,
            resourceId: m.original.resourceId,
          });
        }),
      );
    },
    // Poll on the same 5s cadence as the task / deployment / serviceTasks
    // collections. The list now carries `latestDeploymentStatus`, which the
    // graph node renders — and build-time transitions (building → failed)
    // schedule no swarm tasks, so they emit no docker event for the
    // project-events stream to invalidate on. Without polling, a failed build
    // would leave the node stale until the next navigation.
    refetchInterval: 5000,
    queryClient,
    getKey: (item) => item.resourceId,
  }),
);
