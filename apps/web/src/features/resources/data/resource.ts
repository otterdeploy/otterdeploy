import { zId } from "@otterdeploy/shared/id";
import { createCollection, type SimpleComparison } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import * as z from "zod";

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
 * The environment filter as live queries push it down. `""` is the
 * unresolved-switcher sentinel (`inActiveEnvironment` renders `eq(env, "")`
 * while the active environment is still loading) — treat it as "no
 * environment filter" rather than failing the id parse.
 */
function parseEnvironmentFilter(
  filters: SimpleComparison[],
): z.infer<typeof environmentIdSchema> | undefined {
  const raw = parseOptionalCol(z.union([environmentIdSchema, z.literal("")]), filters, "environmentId");
  return raw === "" ? undefined : raw;
}

/**
 * Namespace prefix for the on-demand resource collection's react-query cache
 * entries. Deliberately distinct from the `orpc.project.resource.list` key so
 * the collection's polled subset queries don't collide with direct one-shot
 * `project.resource.list` reads. Exported as the single source of truth: any
 * code that needs to refetch the graph invalidates THIS, instead of re-typing
 * the `["resource"]` literal (which drifts silently if the prefix ever changes).
 */
export const RESOURCE_COLLECTION_KEY = ["resource"] as const;

type ResourceRow = Awaited<ReturnType<typeof orpc.project.resource.list.call>>[number];

/**
 * Fetch one project's resource rows, applying the client-side twin of the
 * server's NULL-means-main rule (inEnvironmentScope): stamp NULL
 * environmentId rows with the environment they were fetched under, so live
 * queries scope with a plain eq() — the or(isNull) expression this replaces
 * was unparseable by the on-demand subset extractor, which silently broke ALL
 * network sync for this collection (2026-08-17 incident). Shared by the
 * collection's queryFn and `prefetchResourceSubset` so the normalization
 * cannot drift between the two.
 */
async function fetchResourceRows(
  projectId: string,
  environmentId: z.infer<typeof environmentIdSchema> | undefined,
): Promise<ResourceRow[]> {
  const rows = await orpc.project.resource.list.call({ projectId, environmentId });
  if (environmentId === undefined) return rows;
  return rows.map((r): ResourceRow => {
    if (r.environmentId !== null) return r;
    const stamped: ResourceRow = { ...r };
    stamped.environmentId = environmentId;
    return stamped;
  });
}

/**
 * Warm one project subset's cache entry (route-loader intent-preload). The
 * on-demand collection's own subset query uses the same key, so a warm entry
 * makes the collection's first load instant. Non-blocking + best-effort.
 */
export function prefetchResourceSubset(projectId: string, environmentId?: string): void {
  // Parse (not cast) to the branded env id the row-stamping fetch expects —
  // callers hand loaders plain strings.
  const envId = environmentId === undefined ? undefined : environmentIdSchema.parse(environmentId);
  void queryClient
    .prefetchQuery({
      queryKey: [
        ...RESOURCE_COLLECTION_KEY,
        ...orpc.project.resource.list.queryKey({ input: { projectId, environmentId: envId } }),
      ],
      queryFn: () => fetchResourceRows(projectId, envId),
    })
    .catch(() => undefined);
}

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
    const environmentId = parseEnvironmentFilter(filters);
    const subsetKey = orpc.project.resource.list.queryKey({
      input: { projectId, environmentId },
    });

    return [...baseQuery, ...subsetKey];
  },
  queryFn: async (ctx) => {
    const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
    if (!filters.at(0)) return [];
    const projectId = parseCol(projectIdSchema, filters, "projectId");
    const environmentId = parseEnvironmentFilter(filters);
    // NULL-environmentId stamping happens inside the shared fetch — see
    // fetchResourceRows above.
    return fetchResourceRows(projectId, environmentId);
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

// PERSISTENCE DISABLED for this collection (2026-08-17 incident): with the
// OPFS SQLite wrapper active, this collection served days-stale rows and
// REGISTERED NO NETWORK QUERIES AT ALL — the edge logs showed zero
// `project.resource.list` requests across hard refreshes while sibling
// persisted collections (dependencies, serviceTasks) synced normally. Every
// resource surface (graph, panels, the postgres public-access toggle)
// rendered a frozen snapshot; mutations succeeded server-side and the UI
// never caught up. Until the persistence spike explains and covers that
// failure mode with a test, resources — the platform's core truth surface —
// stay network-synced only.
export const resourceCollection = createCollection(resourceQueryOptions);
