import { zId } from "@otterdeploy/shared/id";
import { createCollection } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";

import { parseCol, projectIdSchema } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Project env vars (one row per (projectId, environmentId, key)) sourced from
 * `project.envVar.list`. Unlike the resource/dependency collections — which are
 * project-scoped only — env-var subsets are keyed by BOTH `projectId` and
 * `environmentId`, since the list endpoint is per-environment. Consumers scope
 * by adding `eq(v.projectId, …)` AND `eq(v.environmentId, …)` to their live
 * query; TanStack DB forwards both as `loadSubsetOptions`, from which
 * `queryKey` / `queryFn` recover the pair to fetch (and cache) the right subset.
 *
 * The row type — and so the insert/update shape — is inferred from the
 * collection (the wire shape of `project.envVar.list`), so views never
 * hand-write it.
 */
const environmentIdSchema = zId("env");

/** Namespace prefix for the project-variables collection — the single source of
 *  truth the variables table invalidates after a bulk env replace. See
 *  [[RESOURCE_COLLECTION_KEY]]. */
export const PROJECT_VARIABLES_COLLECTION_KEY = ["projectVariables"] as const;

export const variablesCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = [...PROJECT_VARIABLES_COLLECTION_KEY];
      const { filters } = parseLoadSubsetOptions(opts);
      // Startup base-key call: query-db-collection calls queryKey({}) once to
      // compute the prefix every subset key must extend. No filters yet.
      if (!filters.at(0)) return baseQuery;
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const environmentId = parseCol(environmentIdSchema, filters, "environmentId");
      const subsetKey = orpc.project.envVar.list.queryKey({
        input: { projectId, environmentId },
      });
      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const environmentId = parseCol(environmentIdSchema, filters, "environmentId");
      return orpc.project.envVar.list.call({ projectId, environmentId });
    },
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.project.envVar.upsert.call({
            projectId: m.modified.projectId,
            environmentId: m.modified.environmentId,
            key: m.modified.key,
            value: m.modified.value,
            isSecret: m.modified.isSecret,
          }),
        ),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          // upsert is the write path for both create and edit; the key never
          // changes (it's part of the identity), so re-send the modified row.
          orpc.project.envVar.upsert.call({
            projectId: m.modified.projectId,
            environmentId: m.modified.environmentId,
            key: m.modified.key,
            value: m.modified.value,
            isSecret: m.modified.isSecret,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.project.envVar.delete.call({
            projectId: m.original.projectId,
            environmentId: m.original.environmentId,
            key: m.original.key,
          }),
        ),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

/** Row shape inferred from the collection — views import this instead of
 *  re-declaring an EnvVarRow interface. */
export type VariableRow =
  ReturnType<typeof variablesCollection.get> extends infer T
    ? T extends undefined
      ? never
      : NonNullable<T>
    : never;
