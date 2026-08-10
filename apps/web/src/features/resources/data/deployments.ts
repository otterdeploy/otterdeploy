import { zId } from "@otterdeploy/shared/id";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection, type SimpleComparison } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import * as z from "zod";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

function parseCol<T extends z.ZodType>(
  schema: T,
  filters: SimpleComparison[],
  field = "id",
): z.infer<T> {
  // `field` is a path array (e.g. ["projectId"] or ["d","projectId"]) shared by
  // reference with the live-query's where-expression. Read the leaf with
  // .at(-1), never mutate.
  const expr = filters.find((f) => f.field.at(-1) === field);
  if (!expr) throw new Error(`${field} is required`);
  return schema.parse(expr.value);
}

const projectIdSchema = zId("prj");
const resourceIdSchema = zId("res");
const deploymentIdSchema = zId("dep");

/**
 * Deployment history: each row is one logical push to swarm (see
 * packages/api/src/routers/project/deployments.ts).
 *
 * Single shared collection rather than one-per-(project, resource): consumers
 * scope it by adding `eq(d.projectId, …)` and `eq(d.resourceId, …)` to their
 * live query. TanStack DB forwards those as `loadSubsetOptions`, from which
 * `queryKey` / `queryFn` recover both ids to fetch (and cache) the right subset.
 *
 * Polling is a FALLBACK, not the transport. Build and runtime transitions are
 * pushed over the project event stream (`useProjectEvents` →
 * `project-event-bus`), which invalidates this collection the moment the
 * builder or the docker event bus reports a change. Status is still derived
 * from live task state on every list, so a poll remains the safety net for a
 * change no event covers, but it does not need to run at build cadence while
 * nothing is building.
 *
 * Hence the adaptive interval below: a project sitting idle used to re-derive
 * every deployment's status every 5 seconds, per mounted view, forever.
 */
/** Namespace prefix for the deployments collection: the single source of truth
 *  the project event stream invalidates when a docker deploy event lands. See
 *  [[RESOURCE_COLLECTION_KEY]]. */
export const DEPLOYMENTS_COLLECTION_KEY = ["deployments"] as const;

const deploymentsQueryOptions = queryCollectionOptions({
  // Stable id, required for SQLite persistence to round-trip (see
  // projectCollection in features/projects/data/project.ts).
  id: "deployments",
  syncMode: "on-demand",
  queryKey: (opts) => {
    const baseQuery = [...DEPLOYMENTS_COLLECTION_KEY];
    const { filters } = parseLoadSubsetOptions(opts);
    // Startup base-key call: query-db-collection calls queryKey({}) once to
    // compute the prefix every subset key must extend. No filters yet. Just
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
  // 5s while anything is in flight (a build's phase transitions are what
  // people watch), 30s otherwise. The push stream is what makes an idle
  // project current, so the slow tick only exists to survive a stream that
  // silently died.
  refetchInterval: (query) => {
    const rows = query.state.data as { status?: string }[] | undefined;
    const inFlight = rows?.some((d) => d.status === "pending" || d.status === "building");
    return inFlight ? 5000 : 30_000;
  },
  queryClient,
  getKey: (d) => d.id,
});

type DeploymentRow = Awaited<
  ReturnType<typeof orpc.project.resource.deployments.list.call>
>[number];

// Two-branch createCollection + pinned generics: same type gymnastics as
// projectCollection (features/projects/data/project.ts).
export const deploymentsCollection = persistence
  ? createCollection(
      persistedCollectionOptions<DeploymentRow, string | number>({
        ...deploymentsQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(deploymentsQueryOptions);

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
/** Namespace prefix for the deployment-tasks collection: the single source of
 *  truth the project event stream invalidates on a docker task event. See
 *  [[RESOURCE_COLLECTION_KEY]]. */
export const DEPLOYMENT_TASKS_COLLECTION_KEY = ["deployment-tasks"] as const;

const deploymentTasksQueryOptions = queryCollectionOptions({
  // Stable id, required for SQLite persistence to round-trip.
  id: "deployment-tasks",
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
  // Same reasoning as the deployments collection: fast only while the tasks
  // are still settling. A converged task set changes on a docker event, which
  // the project stream already pushes.
  refetchInterval: (query) => {
    const rows = query.state.data as { state?: string }[] | undefined;
    const settling = rows?.some(
      (t) => t.state !== "running" && t.state !== "complete" && t.state !== "shutdown",
    );
    return settling ? 5000 : 30_000;
  },
  queryClient,
  getKey: (t) => t.id,
});

type DeploymentTaskRow = Awaited<
  ReturnType<typeof orpc.project.resource.deployments.tasks.call>
>[number];

export const deploymentTasksCollection = persistence
  ? createCollection(
      persistedCollectionOptions<DeploymentTaskRow, string | number>({
        ...deploymentTasksQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(deploymentTasksQueryOptions);
