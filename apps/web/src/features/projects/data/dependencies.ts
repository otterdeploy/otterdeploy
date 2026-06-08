import { createCollection, type SimpleComparison } from "@tanstack/db";
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from "@tanstack/query-db-collection";

import { z } from "zod";

import { zId } from "@otterdeploy/shared/id";

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

export const dependenciesCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const { filters } = parseLoadSubsetOptions(opts);
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      return orpc.project.dependencies.queryKey({ input: { projectId } });
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
