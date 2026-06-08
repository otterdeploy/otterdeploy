import { createCollection, type SimpleComparison } from "@tanstack/db";
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from "@tanstack/query-db-collection";

import { z } from "zod";

import { zId } from "@otterdeploy/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Deployment history — each row is one logical push to swarm (see
 * packages/api/src/routers/project/deployments.ts).
 *
 * Single shared collection rather than one-per-(project, resource): consumers
 * scope it by adding `eq(d.projectId, …)` and `eq(d.resourceId, …)` to their
 * live query. TanStack DB forwards those as `loadSubsetOptions`, from which
 * `queryKey` / `queryFn` recover both ids to fetch (and cache) the right subset.
 *
 * 5s refetchInterval: status is derived from underlying tasks every time we
 * list, so we poll to catch state transitions on running tasks.
 */
function parseCol<T extends z.ZodType>(
  schema: T,
  filters: SimpleComparison[],
  field = "id",
): z.infer<T> {
  // `field` on a SimpleComparison is a path array (e.g. ["projectId"]); match
  // on its leaf segment.
  const expr = filters.find((f) => f.field.at(-1) === field);
  if (!expr) throw new Error(`${field} is required`);
  return schema.parse(expr.value);
}

const projectIdSchema = zId("project");
const resourceIdSchema = zId("resource");

export const deploymentsCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const { filters } = parseLoadSubsetOptions(opts);
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
      return orpc.project.resource.deployments.list.queryKey({
        input: { projectId, resourceId },
      });
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
      return orpc.project.resource.deployments.list.call({
        projectId,
        resourceId,
      });
    },
    refetchInterval: 5000,
    queryClient,
    getKey: (d) => d.id,
  }),
);
