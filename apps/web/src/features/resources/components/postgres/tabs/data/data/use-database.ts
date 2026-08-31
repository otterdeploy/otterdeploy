/**
 * Data-viewer fetching hooks, over the typed `data.*` procedures.
 *
 * What this file used to be: a React-Query layer over `database.query`, where
 * every hook shipped a hand-written SQL string built in the BROWSER
 * (`primaryKeysSql`, `columnTypesSql`, `foreignKeysSql`, `structureSql`,
 * `tableColumnsSql`, `browseRowsSql`, `referencedRowSql`). Six statements, all
 * duplicating catalog SQL that now lives once per dialect in
 * `@otterdeploy/data-engine`, and all of them arriving as
 * `Array<Array<string | null>>` — a shape in which SQL NULL and the empty
 * string are the same value.
 *
 * What it is now: the schema comes from one collection, and rows come from
 * `data.browse`, which takes a filter MODEL rather than a statement. The client
 * no longer authors SQL for anything except the explicit SQL runner.
 */
import type { CellKind, ColumnMeta } from "@otterdeploy/data-engine";

import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMutation, useQuery } from "@tanstack/react-query";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { orpc } from "@/shared/server/orpc";

import type { ColumnVariant, TableRef } from "./queries";
import type { WorkbenchTarget } from "./target";

import { schemaCollection, schemaMetaFor, tableId, type SchemaTableRow } from "./schema-collection";
import { toStructureColumns } from "./structure";

/**
 * How a typed cell family maps onto the shared DataGrid's renderer.
 *
 * These are different concepts and both are needed: `CellKind` is what the
 * DATABASE said, `ColumnVariant` is how the GRID draws it. Deriving one from
 * the other keeps the mapping in a single place — the predecessor ran a second
 * regex over the raw pg type name (`pgTypeToVariant`), which is how `int8` and
 * `numeric` both ended up rendering as plain text.
 */
const VARIANT_BY_KIND: Record<CellKind, ColumnVariant> = {
  bool: "boolean",
  number: "number",
  bigint: "number",
  decimal: "number",
  instant: "date",
  datetime: "date",
  date: "date",
  time: "short-text",
  text: "short-text",
  json: "short-text",
  bytes: "short-text",
  array: "short-text",
  opaque: "short-text",
};

export function variantForKind(kind: CellKind): ColumnVariant {
  return VARIANT_BY_KIND[kind];
}

/** The database's tables. One call; columns included. */
export function useDatabaseSchema(target: WorkbenchTarget) {
  const collection = schemaCollection(target);
  const { data, isLoading, isError } = useLiveQuery((q) => q.from({ t: collection }), [collection]);
  return {
    tables: data ?? [],
    meta: schemaMetaFor(target),
    isLoading,
    isError,
  };
}

/** One table's row from the schema collection, or null while it loads. */
function useTableMeta(target: WorkbenchTarget, table: TableRef | null): SchemaTableRow | null {
  const collection = schemaCollection(target);
  const id = table ? tableId(table.schema, table.name) : "";
  const { data } = useLiveQuery(
    (q) => q.from({ t: collection }).where(({ t }) => eq(t.id, id)),
    [collection, id],
  );
  return data?.[0] ?? null;
}

/**
 * Everything the grid needs about the open table's columns.
 *
 * All of it is derived from the schema already in memory. The predecessor made
 * three network round trips for exactly this, every time you clicked a table.
 */
export function useOpenTableColumns(target: WorkbenchTarget, table: TableRef | null) {
  const meta = useTableMeta(target, table);
  const columns: ColumnMeta[] = meta?.columns ?? [];

  const columnVariants: Record<string, ColumnVariant> = {};
  const columnTypes: Record<string, string> = {};
  const columnFks: Record<string, FkTarget> = {};
  for (const c of columns) {
    columnVariants[c.name] = variantForKind(c.kind);
    columnTypes[c.name] = c.dataType;
    if (c.references) {
      columnFks[c.name] = {
        schema: c.references.schema,
        table: c.references.name,
        column: c.references.column,
      };
    }
  }

  return {
    columns,
    columnVariants,
    columnTypes,
    columnFks,
    primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    /** False when the table has no primary key: no row can be targeted safely. */
    canEdit: meta?.canEdit ?? false,
  };
}

/** Whether the actor may write at all (engine capability + permission). */
export function useDataCapabilities(target: WorkbenchTarget) {
  const { meta } = useDatabaseSchema(target);
  return { data: { canWrite: meta?.canWrite ?? false } };
}

export { useBrowseRows, type BrowseRowsResult } from "./use-browse-rows";

/**
 * Column detail for the Structure view and the Add-record modal.
 *
 * Derived from the schema already in memory — the version this replaces made a
 * separate `structureSql` round trip and parsed ten positional columns out of a
 * string grid by index.
 */
export function useTableStructure({
  target,
  table,
}: {
  target: WorkbenchTarget;
  table: TableRef | null;
}) {
  const meta = useTableMeta(target, table);
  const { isLoading, isError } = useDatabaseSchema(target);
  return {
    query: { isLoading, isError, error: isError ? new Error("Could not read the schema") : null },
    columns: meta?.columns ?? [],
    structure: toStructureColumns(meta?.columns ?? []),
  };
}

/** Columns for one table in the schema explorer's expandable rows. */
export function useTableColumns({ target, table }: { target: WorkbenchTarget; table: TableRef }) {
  const meta = useTableMeta(target, table);
  const { isLoading, isError } = useDatabaseSchema(target);
  return { columns: meta?.columns ?? [], isLoading, isError };
}

/**
 * Indexes, constraints and enums for the Definitions view.
 *
 * Its own query rather than more fields on the schema call: the navigator needs
 * the schema on open and needs it fast, and nobody browsing rows is waiting on
 * an index list. Cached generously — schema objects change on DDL, not on the
 * minute.
 */
export function useDefinitions(target: WorkbenchTarget) {
  return useQuery({
    ...orpc.data.definitions.queryOptions({ input: { target } }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Apply staged row edits as ONE transaction.
 *
 * The grid's edits are structured — table, primary key, column assignments —
 * and the SERVER builds the statements from the table's own introspected
 * columns. Nothing here sends SQL.
 */
export function useMutateRows() {
  return useMutation(orpc.data.mutate.mutationOptions());
}

/**
 * The single row a FK cell points at, for the reference popover.
 *
 * Now a filtered browse rather than a hand-built `WHERE col = '<escaped>'`:
 * same code path, same parameter binding, one fewer statement in the browser.
 */
export function useReferencedRow({
  target,
  fk,
  value,
}: {
  target: WorkbenchTarget;
  fk: FkTarget;
  value: string;
}) {
  return useQuery(
    orpc.data.browse.queryOptions({
      input: {
        target,
        schema: fk.schema,
        table: fk.table,
        columns: [],
        filters: [{ column: fk.column, op: "eq", values: [value], enabled: true }],
        sorts: [],
        limit: 1,
        offset: 0,
      },
    }),
  );
}
