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
import { useEffect, useEffectEvent, useRef, useState } from "react";

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
  // Three states, not two: `undefined` is "never chosen" and takes the default
  // below, `null` is an explicit "all schemas", a string is that schema. Two
  // states cannot express both "default to public" and "I really do want all".
  const [pickedSchema, setPickedSchema] = useState<string | null | undefined>(undefined);
  const needle = search.trim().toLowerCase();
  // Distinct schemas, in the order the engine reported them. A database with
  // one schema needs no picker, and the rail hides it in that case.
  const schemas = [...new Set(tables.map((t) => t.schema))];
  // Derived rather than set from an effect: `public` is where a Postgres user's
  // own tables live, and opening onto every schema at once buries them under
  // `drizzle` and `information_schema`.
  const activeSchema =
    pickedSchema === undefined ? (schemas.includes("public") ? "public" : null) : pickedSchema;
  const inSchema = activeSchema === null ? tables : tables.filter((t) => t.schema === activeSchema);
  const filteredTables = needle
    ? inSchema.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(needle))
    : inSchema;

  // Shaped like the query object the views used to receive, so the loading and
  // error branches in the rails did not have to change.
  const tablesQuery = {
    isLoading,
    isError,
    error: isError ? new Error("Could not read the database schema") : null,
    refetch: () => schemaCollection(target).utils.refetch(),
  };
  return {
    tablesQuery,
    tables,
    filteredTables,
    schemas,
    activeSchema,
    setActiveSchema: setPickedSchema,
  };
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

/**
 * Land on the first table once the list loads, or fall back to the SQL editor
 * when the database has none. Fires once, so it never fights a manual switch.
 */
export function useAutoOpenFirstTable(
  selected: TableRef | null,
  tables: TableRef[],
  isLoading: boolean,
  openTable: (table: TableRef) => void,
  openEmpty: () => void,
) {
  const autoOpenedRef = useRef(false);
  const autoOpen = useEffectEvent(openTable);
  const openQueryWhenEmpty = useEffectEvent(openEmpty);

  useEffect(() => {
    if (autoOpenedRef.current || selected) return;
    if (tables[0]) {
      autoOpenedRef.current = true;
      autoOpen(tables[0]);
    } else if (!isLoading) {
      autoOpenedRef.current = true;
      openQueryWhenEmpty();
    }
  }, [selected, tables, isLoading]);
}
