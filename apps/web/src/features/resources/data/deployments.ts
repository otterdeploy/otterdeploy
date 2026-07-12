import { zId } from "@otterdeploy/shared/id";
import { createCollection, type SimpleComparison } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import { z } from "zod";

import { orpc, queryClient } from "@/shared/server/orpc";

function parseCol<T extends z.ZodType>(
  schema: T,
  filters: SimpleComparison[],
  field = "id",
): z.infer<T> {
  // `field` is a path array (e.g. ["projectId"] or ["d","projectId"]) shared by
  // reference with the live-query's where-expression — read the leaf with
  // .at(-1), never mutate.
  const expr = filters.find((f) => f.field.at(-1) === field);
  if (!expr) throw new Error(`${field} is required`);
  return schema.parse(expr.value);
}

const projectIdSchema = zId("project");
const resourceIdSchema = zId("resource");
const deploymentIdSchema = zId("deployment");

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
/** Namespace prefix for the deployments collection — the single source of truth
 *  the project event stream invalidates when a docker deploy event lands. See
 *  [[RESOURCE_COLLECTION_KEY]]. */
export const DEPLOYMENTS_COLLECTION_KEY = ["deployments"] as const;

export const deploymentsCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = [...DEPLOYMENTS_COLLECTION_KEY];
      const { filters } = parseLoadSubsetOptions(opts);
      // Startup base-key call: query-db-collection calls queryKey({}) once to
      // compute the prefix every subset key must extend. No filters yet — just
      // return the prefix.
      if (!filters.at(0)) return baseQuery;
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
      const subsetKey = orpc.project.resource.deployments.list.queryKey({
        input: { projectId, resourceId },
      });
      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
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
/** Namespace prefix for the deployment-tasks collection — the single source of
 *  truth the project event stream invalidates on a docker task event. See
 *  [[RESOURCE_COLLECTION_KEY]]. */
export const DEPLOYMENT_TASKS_COLLECTION_KEY = ["deployment-tasks"] as const;

export const deploymentTasksCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = [...DEPLOYMENT_TASKS_COLLECTION_KEY];
      const { filters } = parseLoadSubsetOptions(opts);
      if (!filters.at(0)) return baseQuery;
      const input = {
        projectId: parseCol(projectIdSchema, filters, "projectId"),
        resourceId: parseCol(resourceIdSchema, filters, "resourceId"),
        deploymentId: parseCol(deploymentIdSchema, filters, "deploymentId"),
      };
      const subsetKey = orpc.project.resource.deployments.tasks.queryKey({
        input,
      });
      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
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
