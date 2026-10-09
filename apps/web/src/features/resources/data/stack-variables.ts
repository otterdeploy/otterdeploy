import { zId } from "@otterdeploy/shared/id";
import { createCollection } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";

import { parseCol, projectIdSchema } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

const resourceIdSchema = zId("res");

/** Namespace prefix for the stack-variables collection's cache entries. */
const STACK_VARIABLES_COLLECTION_KEY = ["stackVariables"] as const;

/**
 * A compose stack's variables: its OWN values plus every `${VAR}`
 * its files reference that it does not set, each with the scope that
 * supplies it (`compose.listVariables`). Consumers scope by adding
 * `eq(v.projectId, …)` and `eq(v.resourceId, …)` to their live query; the
 * pair comes back as `loadSubsetOptions` and picks the subset to fetch.
 *
 * Writes go to the STACK only: insert/update call `compose.setVariable`,
 * delete calls `compose.deleteVariable`. Turning an inherited row into a
 * stack value is an update (its key already exists here). The collection
 * refetches after each write, so a deleted override reappears as the scope
 * it now falls back to.
 *
 * Not persisted, for the reason the project variables collection gives:
 * unsealed values arrive in plaintext and must not reach the browser's disk.
 */
const stackVariablesQueryOptions = queryCollectionOptions({
  id: "stack-variables",
  syncMode: "on-demand",
  queryKey: (opts) => {
    const baseQuery = [...STACK_VARIABLES_COLLECTION_KEY];
    const { filters } = parseLoadSubsetOptions(opts);
    if (!filters.at(0)) return baseQuery;
    const projectId = parseCol(projectIdSchema, filters, "projectId");
    const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
    return [
      ...baseQuery,
      ...orpc.compose.listVariables.queryKey({ input: { projectId, resourceId } }),
    ];
  },
  queryFn: async (ctx) => {
    const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
    if (!filters.at(0)) return [];
    const projectId = parseCol(projectIdSchema, filters, "projectId");
    const resourceId = parseCol(resourceIdSchema, filters, "resourceId");
    const rows = await orpc.compose.listVariables.call({ projectId, resourceId });
    return rows.map((row) => ({ ...row, projectId, resourceId }));
  },
  onInsert: async ({ transaction }) => {
    await Promise.all(transaction.mutations.map((m) => writeStackVariable(m.modified)));
  },
  onUpdate: async ({ transaction }) => {
    await Promise.all(transaction.mutations.map((m) => writeStackVariable(m.modified)));
  },
  onDelete: async ({ transaction }) => {
    await Promise.all(
      transaction.mutations.map((m) =>
        orpc.compose.deleteVariable.call({
          projectId: m.original.projectId,
          resourceId: m.original.resourceId,
          key: m.original.key,
        }),
      ),
    );
  },
  queryClient,
  getKey: (row) => `${row.resourceId}:${row.key}`,
});

function writeStackVariable(row: {
  projectId: string;
  resourceId: string;
  key: string;
  value: string;
  isSecret: boolean;
}) {
  return orpc.compose.setVariable.call({
    projectId: row.projectId,
    resourceId: row.resourceId,
    key: row.key,
    value: row.value,
    isSecret: row.isSecret,
  });
}

export const stackVariablesCollection = createCollection(stackVariablesQueryOptions);

/** Row shape inferred from the collection, so views never restate it. */
export type StackVariableRow =
  ReturnType<typeof stackVariablesCollection.get> extends infer T
    ? T extends undefined
      ? never
      : NonNullable<T>
    : never;
