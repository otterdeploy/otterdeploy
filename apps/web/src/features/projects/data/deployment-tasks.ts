import { createCollection, type SimpleComparison } from "@tanstack/db";
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from "@tanstack/query-db-collection";

import { z } from "zod";

import { zId } from "@otterdeploy/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Swarm tasks (containers) for one deployment, keyed by task id. Backed by
 * project.resource.deployments.tasks.
 *
 * Single shared collection rather than one-per-deployment: consumers scope it
 * by adding `eq(d.projectId, …)`, `eq(d.resourceId, …)` and
 * `eq(d.deploymentId, …)` to their live query. TanStack DB forwards those as
 * `loadSubsetOptions`, from which `queryKey` / `queryFn` recover the three ids
 * to fetch (and cache) the right subset.
 *
 * 5s refetchInterval so task state (running / building / error) stays current
 * as swarm converges.
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
const deploymentIdSchema = zId("deployment");

export const deploymentTasksCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const { filters } = parseLoadSubsetOptions(opts);
      const input = {
        projectId: parseCol(projectIdSchema, filters, "projectId"),
        resourceId: parseCol(resourceIdSchema, filters, "resourceId"),
        deploymentId: parseCol(deploymentIdSchema, filters, "deploymentId"),
      };
      return orpc.project.resource.deployments.tasks.queryKey({ input });
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const input = {
        projectId: parseCol(projectIdSchema, filters, "projectId"),
        resourceId: parseCol(resourceIdSchema, filters, "resourceId"),
        deploymentId: parseCol(deploymentIdSchema, filters, "deploymentId"),
      };
      return orpc.project.resource.deployments.tasks.call(input);
    },
    refetchInterval: 5000,
    queryClient,
    getKey: (t) => t.id,
  }),
);
