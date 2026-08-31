/**
 * A page of rows for the table browser — computed from the CLIENT-side window
 * collection when the table fits in it, from the server when it does not.
 *
 * Filters and sorts still travel as a MODEL on the server path: it compiles
 * them with operands bound and columns checked, so neither can carry syntax
 * into the statement. On the window path the same model is evaluated locally
 * (rows-window.ts), which is what makes twisting a filter feel instant.
 */
import type { Filter, Grid, Sort } from "@otterdeploy/data-engine";

import { useMemo } from "react";

import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { TableRef } from "./queries";
import type { WorkbenchTarget } from "./target";

import {
  applyRowsView,
  emptyRowsCollection,
  refetchRowsWindow,
  ROWS_WINDOW,
  rowsWindowCollection,
} from "./rows-window";
import { schemaCollection, tableId } from "./schema-collection";

/**
 * A page of rows for the table browser.
 *
 * Filters and sorts travel as a MODEL. The server compiles them with the
 * operands bound as parameters and the column names checked against the
 * table's real columns, so neither can carry syntax into the statement — which
 * the old `buildWhere` string interpolation could not promise.
 */
export function useBrowseRows({
  target,
  table,
  filters,
  sorts,
  limit,
  offset,
  enabled,
  keepPrevious,
}: {
  target: WorkbenchTarget;
  table: TableRef | null;
  filters: Filter[];
  sorts: Sort[];
  limit: number;
  offset: number;
  enabled: boolean;
  keepPrevious: boolean;
}): BrowseRowsResult {
  // The table's first ROWS_WINDOW rows, held CLIENT-SIDE in a TanStack DB
  // collection. Filters, sorts and pages are computed against that copy, so
  // touching any of them costs zero round trips. See data/rows-window.ts.
  const wanted = table !== null && enabled;
  const collection =
    wanted && table !== null ? rowsWindowCollection(target, table) : emptyRowsCollection();
  const live = useLiveQuery((q) => q.from({ r: collection }), [collection]);

  const columns = useColumnsFromSchema(target, table);

  // A full window means the table may extend past it; filtering the copy
  // would silently miss rows, so those tables take the exact server path.
  const overflow = (live.data?.length ?? 0) >= ROWS_WINDOW;

  // A table BIGGER than the window falls back to exact server-side filtering:
  // filtering a partial copy would silently miss rows the window never held.
  const serverQuery = useQuery({
    ...orpc.data.browse.queryOptions({
      input: {
        target,
        schema: table?.schema ?? "",
        table: table?.name ?? "",
        columns: [],
        filters,
        sorts,
        limit,
        offset,
      },
    }),
    enabled: wanted && overflow,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: BROWSE_STALE_MS,
    placeholderData: keepPrevious ? (prev) => prev : undefined,
  });

  const windowGrid = useWindowGrid({
    rows: overflow || table === null ? undefined : live.data,
    columns,
    filters,
    sorts,
    limit,
    offset,
  });

  const refetch = () => {
    if (table !== null) refetchRowsWindow(target, table);
    if (overflow) void serverQuery.refetch();
  };

  if (overflow) return serverShape(serverQuery, refetch);
  return windowShape(windowGrid, wanted, live, refetch);
}

function serverShape(
  q: {
    data: Grid | undefined;
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    error: unknown;
  },
  refetch: () => void,
): BrowseRowsResult {
  return {
    data: q.data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch,
  };
}

/** Columns from the SCHEMA collection — client-side, and present even when
 *  the rows hydrated from cache without re-running their fetch. */
function useColumnsFromSchema(target: WorkbenchTarget, table: TableRef | null) {
  const schema = schemaCollection(target);
  const id = table === null ? "" : tableId(table.schema, table.name);
  const { data } = useLiveQuery(
    (q) => q.from({ t: schema }).where(({ t }) => eq(t.id, id)),
    [schema, id],
  );
  return data?.[0]?.columns;
}

/** The client-side page: the filter/sort/page model applied to the window. */
function useWindowGrid(input: {
  rows: readonly Parameters<typeof applyRowsView>[0]["rows"][number][] | undefined;
  columns: Grid["columns"] | undefined;
  filters: Filter[];
  sorts: Sort[];
  limit: number;
  offset: number;
}): Grid | undefined {
  const { rows, columns, filters, sorts, limit, offset } = input;
  return useMemo(() => {
    if (rows === undefined || columns === undefined) return undefined;
    const view = applyRowsView({ rows, columns, filters, sorts, limit, offset });
    return {
      columns,
      rows: view.page,
      rowCount: view.page.length,
      // The pager's "has next": more MATCHED rows exist past this page.
      truncated: offset + view.page.length < view.matched,
      rowsAffected: null,
      // Served from the client-side window: no wire time to report.
      durationMs: 0,
      notices: [],
    };
  }, [rows, columns, filters, sorts, limit, offset]);
}

function windowShape(
  data: Grid | undefined,
  wanted: boolean,
  live: { isLoading: boolean; isError?: boolean },
  refetch: () => void,
): BrowseRowsResult {
  const failed = live.isError === true;
  return {
    data,
    isLoading: wanted && live.isLoading,
    isFetching: live.isLoading,
    isError: failed,
    error: failed ? new Error("Could not load the table's rows.") : null,
    refetch,
  };
}

/** The query-shaped surface every consumer of a rows result reads. */
export interface BrowseRowsResult {
  data: Grid | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

const BROWSE_STALE_MS = 30_000;
