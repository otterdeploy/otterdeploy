import { zId } from "@otterdeploy/shared/id";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection, type SimpleComparison } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import * as z from "zod";

import { persistence } from "@/shared/db/sqlite-persistence";
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
/**
 * Optional variant of {@link parseCol}. The environment filter is absent on a
 * first render (the switcher hasn't resolved yet) and present immediately
 * after, so its absence is a normal state, not a programming error.
 */
function parseOptionalCol<T extends z.ZodType>(
  schema: T,
  filters: SimpleComparison[],
  field: string,
): z.infer<T> | undefined {
  const expr = filters.find((f) => f.field.at(-1) === field);
  return expr === undefined ? undefined : schema.parse(expr.value);
}

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

const projectIdSchema = zId("prj");
const environmentIdSchema = zId("env");

/**
 * Namespace prefix for the on-demand resource collection's react-query cache
 * entries. Deliberately distinct from the `orpc.project.resource.list` key so
 * the collection's polled subset queries don't collide with direct one-shot
 * `project.resource.list` reads. Exported as the single source of truth: any
 * code that needs to refetch the graph invalidates THIS, instead of re-typing
 * the `["resource"]` literal (which drifts silently if the prefix ever changes).
 */
export const RESOURCE_COLLECTION_KEY = ["resource"] as const;

const resourceQueryOptions = queryCollectionOptions({
  // Stable id — required for SQLite persistence to round-trip (see
  // projectCollection in features/projects/data/project.ts).
  id: "resources",
  syncMode: "on-demand",
  queryKey: (opts) => {
    const baseQuery = [...RESOURCE_COLLECTION_KEY];
    const { filters } = parseLoadSubsetOptions(opts);
    // Startup base-key call: query-db-collection calls queryKey({}) once to
    // compute the prefix every subset key must extend. No filters yet — just
    // return the prefix.
    if (!filters.at(0)) return baseQuery;
    const projectId = parseCol(projectIdSchema, filters, "projectId");
    // The environment MUST be part of the key. Without it every environment
    // shares one cache entry, so switching the switcher re-renders the
    // previous environment's rows and never refetches — the switcher looked
    // broken when in fact nothing had asked the server a new question.
    const environmentId = parseOptionalCol(environmentIdSchema, filters, "environmentId");
    const subsetKey = orpc.project.resource.list.queryKey({
      input: { projectId, environmentId },
    });

    return [...baseQuery, ...subsetKey];
  },
  queryFn: async (ctx) => {
    const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
    if (!filters.at(0)) return [];
    const projectId = parseCol(projectIdSchema, filters, "projectId");
    const environmentId = parseOptionalCol(environmentIdSchema, filters, "environmentId");
    return orpc.project.resource.list.call({ projectId, environmentId });
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
  // Repair backstop, not the freshness mechanism. Live changes arrive as
  // pushes: docker transitions via the project-events stream, and
  // build-time transitions (building → failed schedule no swarm tasks, so
  // no docker event) via publishResourceChanged on the Redis event bus —
  // both invalidate this collection through useProjectEvents. The poll
  // only covers a missed/dropped event. At 5s it multiplied with the
  // event-driven refetches into ~100 list calls/min on an idle tab.
  refetchInterval: 30_000,
  queryClient,
  getKey: (item) => item.resourceId,
});

type ResourceRow = Awaited<ReturnType<typeof orpc.project.resource.list.call>>[number];

// Two-branch createCollection + pinned generics — same type gymnastics as
// projectCollection (features/projects/data/project.ts).
export const resourceCollection = persistence
  ? createCollection(
      persistedCollectionOptions<ResourceRow, string | number>({
        ...resourceQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(resourceQueryOptions);
