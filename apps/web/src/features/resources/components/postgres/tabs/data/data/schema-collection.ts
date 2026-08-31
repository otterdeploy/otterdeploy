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
import type { ColumnMeta } from "@otterdeploy/data-engine";

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

import type { WorkbenchTarget } from "./target";

import { targetKey } from "./target";

/** One row per table, carrying its columns. Keyed by `schema.name`. */
export interface SchemaTableRow {
  /** `schema.name`, or just `name` when the dialect has no schemas. */
  id: string;
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view" | "foreign_table";
  estimatedRows: number | null;
  sizeBytes: number | null;
  comment: string | null;
  columns: ColumnMeta[];
  /** False when the table has no primary key, so no row can be targeted. */
  canEdit: boolean;
}

export interface SchemaMeta {
  dialect: "postgres" | "mysql" | "clickhouse";
  defaultSchema: string;
  canWrite: boolean;
}

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
      queryKey: orpc.data.schema.queryKey({ input: { target } }),
      queryFn: async (): Promise<SchemaTableRow[]> => {
        const result = await orpc.data.schema.call({ target });
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
