import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { parseLoadSubsetOptions } from "@tanstack/query-db-collection";

import { parseCol, projectIdSchema } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

export const serviceTasksCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    refetchInterval: 5000,
    queryKey: (opts) => {
      const baseQuery = ["service-tasks"];
      const { filters } = parseLoadSubsetOptions(opts);

      if (!filters.at(0)) return baseQuery;

      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const queryKey = orpc.project.serviceTasks.queryKey({
        input: { projectId },
      });
      return [...baseQuery, ...queryKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);

      const projectId = parseCol(projectIdSchema, filters, "projectId");

      // The endpoint returns { resourceId, tasks } with no projectId (it took
      // projectId as a path param and doesn't echo it). Stamp it back on here —
      // we already have it from the where-filter above — so the field is a real
      // column the live query can filter / join on with eq(d.projectId, …).
      const rows = await orpc.project.serviceTasks.call({ projectId });
      return rows.map((row) => ({ ...row, projectId }));
    },
    queryClient,
    getKey: (entry) => entry.resourceId,
  }),
);
