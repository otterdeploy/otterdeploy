import type * as z from "zod";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { parseLoadSubsetOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { parseCol, projectIdSchema } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

/** Namespace prefix for the live service-tasks collection — the single source
 *  of truth manifest apply + the project event stream invalidate to refresh
 *  per-service task rollups. See [[RESOURCE_COLLECTION_KEY]]. */
export const SERVICE_TASKS_COLLECTION_KEY = ["service-tasks"] as const;

const serviceTasksQueryOptions = queryCollectionOptions({
  // Stable id — required for SQLite persistence to round-trip (see
  // projectCollection in features/projects/data/project.ts).
  id: "service-tasks",
  syncMode: "on-demand",
  // Repair backstop — task transitions push through the project-events
  // stream and invalidate this collection (see useProjectEvents), so the
  // poll only covers a missed event. Keep in step with the resource
  // collection's interval ([[RESOURCE_COLLECTION_KEY]]).
  refetchInterval: 30_000,
  queryKey: (opts) => {
    const baseQuery = [...SERVICE_TASKS_COLLECTION_KEY];
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
});

// queryFn stamps projectId onto each server row, so the row type is the RPC
// element plus that column.
type ServiceTaskRow = Awaited<ReturnType<typeof orpc.project.serviceTasks.call>>[number] & {
  projectId: z.infer<typeof projectIdSchema>;
};

// Two-branch createCollection + pinned generics — same type gymnastics as
// projectCollection (features/projects/data/project.ts).
export const serviceTasksCollection = persistence
  ? createCollection(
      persistedCollectionOptions<ServiceTaskRow, string | number>({
        ...serviceTasksQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(serviceTasksQueryOptions);
