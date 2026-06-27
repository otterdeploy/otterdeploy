/**
 * Data-viewer fetching hooks — the React-Query layer over `database.query` /
 * `database.tables`. Everything that *reads* the live database lives here, so
 * the components stay presentational; SQL strings come from `./queries`.
 *
 * `resourceId` is typed `string` here and cast to the branded oRPC input type
 * at the call boundary (`never` is assignable to any input type) — callers pass
 * the plain resource id.
 */

import { useMemo } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { orpc } from "@/shared/server/orpc";

import {
  columnTypesSql,
  foreignKeysSql,
  pgTypeToVariant,
  primaryKeysSql,
  referencedRowSql,
  tableColumnsSql,
  type ColumnVariant,
  type TableRef,
} from "./queries";

/** List the database's tables (the navigator + autocomplete source). */
export function useDatabaseTables(resourceId: string) {
  return useQuery(
    orpc.database.tables.queryOptions({
      input: { resourceId: resourceId as never },
    }),
  );
}

/** Whether the actor may mutate data (drives read-only vs editable grid). */
export function useDataCapabilities(resourceId: string) {
  return useQuery(
    orpc.database.capabilities.queryOptions({
      input: { resourceId: resourceId as never },
    }),
  );
}

/**
 * Primary-key columns for the selected table, in key order. An empty array
 * (table has no PK) means rows can't be edited — the grid stays read-only.
 */
export function useTablePrimaryKey({
  resourceId,
  table,
  enabled,
}: {
  resourceId: string;
  table: TableRef | null;
  enabled: boolean;
}) {
  const query = useQuery({
    ...orpc.database.query.queryOptions({
      input: {
        resourceId: resourceId as never,
        sql: table ? primaryKeysSql(table) : "",
        limit: 100,
      },
    }),
    enabled: enabled && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
  const pkColumns = useMemo(
    () => (query.data?.rows ?? []).map((r) => r[0]).filter((c): c is string => c != null),
    [query.data],
  );
  return pkColumns;
}

/** Run a structured row mutation (insert/update/delete) on the server. The
 *  caller passes the full input (resourceId + schema/table/op/pk/set). */
export function useMutateRow() {
  return useMutation(orpc.database.mutateRow.mutationOptions());
}

/** Run ARBITRARY SQL (DML/DDL) — the write console. `database:write` gated +
 *  audited server-side; returns the grid (rowCount = rows affected). */
export function useExecuteSql() {
  return useMutation(orpc.database.execute.mutationOptions());
}

/**
 * Run a read-only query and return its rows. Drives both the table browser
 * (`keepPrevious` holds rows on screen across sort/page changes) and the SQL
 * console (each run is a fresh query, so carrying stale rows is suppressed).
 */
export function useQueryRows({
  resourceId,
  sql,
  limit,
  enabled,
  keepPrevious,
}: {
  resourceId: string;
  sql: string;
  limit: number;
  enabled: boolean;
  keepPrevious: boolean;
}) {
  return useQuery({
    ...orpc.database.query.queryOptions({
      input: { resourceId: resourceId as never, sql, limit },
    }),
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: keepPrevious ? (prev) => prev : undefined,
  });
}

/**
 * Cell variants + FK targets for the selected table — both read
 * `information_schema` through the same read-only query path, then reshape into
 * column-keyed maps the grid consumes.
 */
export function useTableColumnMeta({
  resourceId,
  table,
  enabled,
}: {
  resourceId: string;
  table: TableRef | null;
  enabled: boolean;
}) {
  const on = enabled && Boolean(table);

  const colTypesQuery = useQuery({
    ...orpc.database.query.queryOptions({
      input: {
        resourceId: resourceId as never,
        sql: table ? columnTypesSql(table) : "",
        limit: 1000,
      },
    }),
    enabled: on,
  });

  const fkQuery = useQuery({
    ...orpc.database.query.queryOptions({
      input: {
        resourceId: resourceId as never,
        sql: table ? foreignKeysSql(table) : "",
        limit: 1000,
      },
    }),
    enabled: on,
  });

  const columnVariants = useMemo(() => {
    const m: Record<string, ColumnVariant> = {};
    for (const row of colTypesQuery.data?.rows ?? []) {
      const name = row[0];
      if (name) m[name] = pgTypeToVariant(row[1] ?? "");
    }
    return m;
  }, [colTypesQuery.data]);

  const columnFks = useMemo(() => {
    const m: Record<string, FkTarget> = {};
    for (const row of fkQuery.data?.rows ?? []) {
      const [col, refSchema, refTable, refCol] = row;
      if (col && refTable && refCol) {
        m[col] = {
          schema: refSchema ?? "public",
          table: refTable,
          column: refCol,
        };
      }
    }
    return m;
  }, [fkQuery.data]);

  return { columnVariants, columnFks };
}

/** Columns + PK flag for one table — lazy (only once its row is expanded). */
export function useTableColumns({
  resourceId,
  table,
  enabled,
}: {
  resourceId: string;
  table: TableRef;
  enabled: boolean;
}) {
  return useQuery({
    ...orpc.database.query.queryOptions({
      input: { resourceId: resourceId as never, sql: tableColumnsSql(table), limit: 500 },
    }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** The single row a FK cell points at, for the FK reference popover. */
export function useReferencedRow({
  resourceId,
  fk,
  value,
}: {
  resourceId: string;
  fk: FkTarget;
  value: string;
}) {
  return useQuery(
    orpc.database.query.queryOptions({
      input: { resourceId: resourceId as never, sql: referencedRowSql(fk, value), limit: 1 },
    }),
  );
}
