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
import type { WorkbenchTarget } from "./data/target";

import { schemaCollection } from "./data/schema-collection";
import { useDatabaseSchema, useOpenTableColumns } from "./data/use-database";

/**
 * The project's tables plus the sidebar-search subset. The filter matches on
 * the qualified `schema.name`, so searching "public." narrows by schema.
 */
export function useTableList(target: WorkbenchTarget, search: string) {
  const { tables, isLoading, isError } = useDatabaseSchema(target);
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
    refetch: () => schemaCollection(target).utils.refetch(),
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
  target,
  table,
  mode,
}: {
  target: WorkbenchTarget;
  table: TableRef | null;
  mode: "table" | "sql";
}) {
  const { meta } = useDatabaseSchema(target);
  const { columns, columnVariants, columnFks, columnTypes, primaryKey, canEdit } =
    useOpenTableColumns(target, table);

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
