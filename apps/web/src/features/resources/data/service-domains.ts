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

/**
 * Domains published by a service — the generated public host plus any
 * operator-added custom hosts (see packages/api/src/routers/service/router-domains.ts).
 * Each row is one proxy_route.
 *
 * Single shared collection rather than one-per-(project, resource): consumers
 * scope it by adding `eq(d.projectId, …)` and `eq(d.resourceId, …)` to their
 * live query. TanStack DB forwards those as `loadSubsetOptions`, from which
 * `queryKey` / `queryFn` recover both ids to fetch (and cache) the right subset.
 *
 * 30s refetchInterval matches the other resource collections; expose/unexpose
 * and the card's own mutations invalidate the "service-domains" prefix to
 * refetch immediately.
 */
export const serviceDomainsCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["service-domains"];
      const { filters } = parseLoadSubsetOptions(opts);
      // Startup base-key call: query-db-collection calls queryKey({}) once to
      // compute the prefix every subset key must extend. No filters yet — just
      // return the prefix.
      if (!filters.at(0)) return baseQuery;
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
      const subsetKey = orpc.service.domains.list.queryKey({
        input: { projectId, resourceId },
      });
      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
      return orpc.service.domains.list.call({ projectId, resourceId });
    },
    refetchInterval: 30_000,
    queryClient,
    getKey: (d) => d.id,
  }),
);
