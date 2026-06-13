import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import { createCollection, type SimpleComparison } from "@tanstack/db";
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from "@tanstack/query-db-collection";

import { z } from "zod";

import { zId } from "@otterdeploy/shared/id";

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

export const resourceCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["resource"];
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

/**
 * Swarm task history for one resource (postgres database, service replica
 * fan-out, etc.). Backed by project.resource.tasks which dispatches on
 * resource kind to derive the right swarm service name.
 *
 * 5s `refetchInterval` so restarts + replica cycles surface live. Reads
 * are synchronous from the local store between fetches — the Deployments
 * tab doesn't flash a loading state on tab switches.
 *
 * @note Memoize with useMemo([projectId, resourceId]) at the call site.
 */
export function createResourceTasksCollection(
  projectId: ProjectId,
  resourceId: ResourceId,
) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.resource.tasks.queryOptions({
        input: { projectId, resourceId },
      }),
      queryKey: orpc.project.resource.tasks.queryKey({
        input: { projectId, resourceId },
      }),
      queryFn: async () =>
        orpc.project.resource.tasks.call({ projectId, resourceId }),
      refetchInterval: 5000,
      queryClient,
      getKey: (t) => t.id,
    }),
  );
}
