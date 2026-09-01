/**
 * The database's schema, as ONE collection.
 *
 * This replaces six separate `database.query` calls that each shipped a
 * hand-written `information_schema` statement from the browser:
 * `primaryKeysSql`, `columnTypesSql`, `foreignKeysSql`, `tableColumnsSql`,
 * `structureSql`, plus `database.tables`. Every one of them duplicated SQL that
 * now lives once, per dialect, in `@otterdeploy/data-engine`.
 *
 * Two things follow from collapsing them:
 *
 *   - Opening a table stops costing a round trip. The old path fetched a
 *     table's columns, primary key and foreign keys lazily *when you clicked
 *     it*, so every click waited on three queries.
 *   - The client stops authoring SQL. It asks for "the schema"; the server
 *     decides how to read it, which is what lets the same call serve MySQL and
 *     ClickHouse without the browser knowing either catalog.
 *
 * It is a TanStack DB collection rather than a bare query so the workbench can
 * read it through live queries and have a future schema-changed event update
 * every open tab, without an invalidation fan-out.
 */
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { Result } from "better-result";

import { orpc, queryClient } from "@/shared/server/orpc";

import type { WorkbenchTarget } from "./target";

import { targetKey } from "./target";

/** Pull the human-readable reason out of an oRPC error: UNREACHABLE and
 *  QUERY_FAILED carry `data.reason`; anything else keeps its message. */
function reasonOf(cause: unknown): Error {
  if (cause && typeof cause === "object" && "data" in cause) {
    const { data } = cause;
    if (data && typeof data === "object" && "reason" in data && typeof data.reason === "string") {
      const message =
        "message" in cause && typeof cause.message === "string" ? cause.message : null;
      return new Error(message ? `${message}: ${data.reason}` : data.reason);
    }
  }
  return cause instanceof Error ? cause : new Error(String(cause));
}

type SchemaResult = InferRouterOutputs<AppRouter>["data"]["schema"];

/** One contract-derived table plus the stable collection key. */
export type SchemaTableRow = SchemaResult["tables"][number] & { id: string };

export type SchemaMeta = Pick<SchemaResult, "canWrite" | "defaultSchema" | "dialect">;

export function tableId(schema: string, name: string): string {
  return schema === "" ? name : `${schema}.${name}`;
}

/**
 * One collection per database resource.
 *
 * Memoised because `createCollection` is stateful: building a new one per
 * render would drop the cache on every keystroke, and TanStack DB keys its
 * persistence off the collection id.
 */
const collections = new Map<string, ReturnType<typeof buildCollection>>();

function buildCollection(target: WorkbenchTarget) {
  const key = targetKey(target);
  return createCollection(
    queryCollectionOptions({
      id: `data-schema:${key}`,
      queryKey: [...orpc.data.schema.queryKey({ input: { target } }), { cacheKey: key }],
      queryFn: async (): Promise<SchemaTableRow[]> => {
        // The collection surfaces failure as a bare `isError`; the WHY (the
        // server's `data.reason`) is kept beside it so the rail can say
        // "connection refused" instead of "could not read the schema".
        const fetched = await Result.tryPromise({
          try: () => orpc.data.schema.call({ target }),
          catch: reasonOf,
        });
        if (fetched.isErr()) {
          schemaErrors.set(key, fetched.error);
          throw fetched.error;
        }
        const result = fetched.value;
        schemaErrors.delete(key);
        schemaMeta.set(key, {
          dialect: result.dialect,
          defaultSchema: result.defaultSchema,
          canWrite: result.canWrite,
        });
        return result.tables.map((t) => ({ ...t, id: tableId(t.schema, t.name) }));
      },
      queryClient,
      getKey: (row) => row.id,
      // The schema is not something the workbench mutates; DDL goes through the
      // SQL runner and lands here on the next refetch. No onInsert/onUpdate.
      staleTime: 60_000,
      // An unreachable database answers the same way four times in a row;
      // don't retry, show the honest error immediately.
      retry: false,
    }),
  );
}

/**
 * Dialect-level facts that arrive with the schema but are not per-table.
 *
 * Held beside the collection rather than duplicated onto every row: they are
 * properties of the connection, and copying them onto 200 table rows would
 * make "which dialect is this" a question with 200 answers.
 */
const schemaMeta = new Map<string, SchemaMeta>();

/** The last fetch failure per target, cleared by the next success. */
const schemaErrors = new Map<string, Error>();

export function schemaErrorFor(target: WorkbenchTarget): Error | null {
  return schemaErrors.get(targetKey(target)) ?? null;
}

export function schemaCollection(target: WorkbenchTarget) {
  const key = targetKey(target);
  const existing = collections.get(key);
  if (existing) return existing;
  const created = buildCollection(target);
  collections.set(key, created);
  return created;
}

export function schemaMetaFor(target: WorkbenchTarget): SchemaMeta | undefined {
  return schemaMeta.get(targetKey(target));
}
