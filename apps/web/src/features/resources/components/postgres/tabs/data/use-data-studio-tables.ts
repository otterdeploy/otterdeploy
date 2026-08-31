/**
 * The table-browse half of the studio controller: the database's table list
 * (and the sidebar's search filter over it), plus everything the studio needs
 * to know about the currently open table.
 *
 * All of it now comes from ONE `data.schema` call, held as a collection. The
 * version this replaces made four network round trips — table list, column
 * types, foreign keys, primary key — and three of them fired again every time
 * you clicked a different table.
 */
import type { TableRef } from "./data/queries";

import { useDatabaseSchema, useOpenTableColumns } from "./data/use-database";

/**
 * The project's tables plus the sidebar-search subset. The filter matches on
 * the qualified `schema.name`, so searching "public." narrows by schema.
 */
export function useTableList(resourceId: string, search: string) {
  const { tables, isLoading, isError } = useDatabaseSchema(resourceId);
  const needle = search.trim().toLowerCase();
  const filteredTables = needle
    ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(needle))
    : tables;

  // Shaped like the query object the views used to receive, so the loading and
  // error branches in the rails did not have to change.
  const tablesQuery = {
    isLoading,
    isError,
    error: isError ? new Error("Could not read the database schema") : null,
    refetch: () => undefined,
  };
  return { tablesQuery, tables, filteredTables };
}

/**
 * Column metadata + write access for the open table.
 *
 * `editable` needs three things to be true at once, and each is reported by
 * the layer that actually knows it: the ENGINE can commit a transaction
 * (`canWrite`), the TABLE has a primary key so a row can be targeted
 * (`canEdit`), and a table is actually open.
 */
export function useOpenTableAccess({
  resourceId,
  table,
  mode,
}: {
  resourceId: string;
  table: TableRef | null;
  mode: "table" | "sql";
}) {
  const { meta } = useDatabaseSchema(resourceId);
  const { columns, columnVariants, columnFks, columnTypes, primaryKey, canEdit } =
    useOpenTableColumns(resourceId, table);

  const canWrite = meta?.canWrite ?? false;

  return {
    columns,
    columnVariants,
    columnFks,
    columnTypes,
    canWrite,
    primaryKey,
    canEdit,
    editable: mode === "table" && canWrite && canEdit && Boolean(table),
  };
}
