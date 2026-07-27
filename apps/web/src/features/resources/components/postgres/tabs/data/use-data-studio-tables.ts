/**
 * The table-browse half of {@link useTableData}: the database's table list (and
 * the sidebar's search filter over it), plus everything the studio needs to know
 * about the currently open table — cell variants, FK targets, display types,
 * the actor's write capability, and the primary key that makes a row targetable.
 *
 * Split out of use-data-studio.ts for size: each of these was a multi-line query
 * call with its own `enabled` gate and `??` fallback, and together they were a
 * third of the controller. Both hooks are called in the same order the
 * controller called their contents, so its hook sequence is unchanged.
 */

import type { TableRef } from "./data/queries";

import {
  useDataCapabilities,
  useDatabaseTables,
  useTableColumnMeta,
  useTablePrimaryKey,
} from "./data/use-database";

/** The project's tables plus the sidebar-search subset. The filter matches on
 *  the qualified `schema.name`, so searching "public." narrows by schema. */
export function useTableList(resourceId: string, search: string) {
  const tablesQuery = useDatabaseTables(resourceId);
  const tables = tablesQuery.data?.tables ?? [];
  const needle = search.trim().toLowerCase();
  const filteredTables = needle
    ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(needle))
    : tables;
  return { tablesQuery, tables, filteredTables };
}

/**
 * Column metadata + write access for the open table.
 *
 * All of it is table-browse only: authored console SQL renders its own result
 * shape, so the column meta stays gated on `mode === "table"`. Inline edit /
 * delete are offered only when the actor has the write capability AND the open
 * table has a primary key to target the row by — hence `editable`.
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
  const { columnVariants, columnFks, columnTypes } = useTableColumnMeta({
    resourceId,
    table,
    enabled: mode === "table",
  });

  const canWrite = useDataCapabilities(resourceId).data?.canWrite ?? false;
  const primaryKey = useTablePrimaryKey({
    resourceId,
    table,
    enabled: mode === "table" && canWrite,
  });

  return {
    columnVariants,
    columnFks,
    columnTypes,
    canWrite,
    primaryKey,
    editable: mode === "table" && canWrite && Boolean(table),
  };
}
