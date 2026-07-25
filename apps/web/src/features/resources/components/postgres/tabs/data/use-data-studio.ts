/**
 * State + actions controller for the Data studio. Splits the (large) studio
 * into composable hooks so each stays small: {@link useSnippetBuffer} owns the
 * editor buffer + snippet store, {@link useTableData} owns the table-browse +
 * query + write path, and {@link useDataStudio} composes them and wires the
 * cross-cutting actions (snippet selection, open-in-SQL, the ⌘K spotlight).
 *
 * The editor imperative handle (`editorRef`) is intentionally NOT part of the
 * returned controller — keeping a ref out of the shared object stops the views
 * from tripping the "no ref access during render" rule. The owning component
 * holds the ref and passes it to the SQL view + spotlight directly.
 *
 * The presentational views (table browser / SQL playground / results panel)
 * consume the returned {@link DataStudioController}.
 */

import { useEffect, useRef, useState } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";

import type { FkTarget } from "@/shared/components/data-grid/types";

import type { PostgresBodyProps } from "../../types";
import type { ResultView } from "./components/results-panel";

import { loadHiddenColumns, saveHiddenColumns } from "./data/column-prefs";
import { buildWhere, type Filter, newFilter } from "./data/filters";
import { browseRowsSql, type TableRef } from "./data/queries";
import { useQueryHistory } from "./data/query-history";
import {
  useDataCapabilities,
  useDatabaseTables,
  useQueryRows,
  useTableColumnMeta,
  useTablePrimaryKey,
} from "./data/use-database";
import {
  buildSchema,
  hasNextPage,
  useRowMutations,
  useSnippetBuffer,
} from "./use-data-studio-helpers";
import { errMessage, useSqlRuns, useWriteConfirm } from "./use-data-studio-sql";

type Resource = PostgresBodyProps["resource"];

export const PAGE_SIZES = [50, 100, 200, 500];

export { errMessage };

function useTableData(resource: Resource) {
  const resourceId = resource.resourceId;
  const resourceIdStr = String(resource.resourceId);

  const [mode, setMode] = useState<"table" | "sql">("table");
  const [tableSearch, setTableSearch] = useState("");
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [view, setView] = useState<ResultView>("grid");
  // Data (rows grid) vs Structure (column detail) for the open table.
  const [tableView, setTableView] = useState<"data" | "structure">("data");
  const [writeMode, setWriteMode] = useState(false);
  // Column names hidden from the grid for the open table (persisted per-table;
  // exports always include every column).
  const [hiddenColumns, setHiddenColumnsState] = useState<string[]>([]);
  const autoOpenedRef = useRef(false);

  const tablesQuery = useDatabaseTables(resourceIdStr);
  const tables = tablesQuery.data?.tables ?? [];
  const tableFilter = tableSearch.trim().toLowerCase();
  const filteredTables = tableFilter
    ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(tableFilter))
    : tables;

  const where = buildWhere(filters);
  const tableSql = selected ? browseRowsSql(selected, where, pageSize + 1, page * pageSize) : "";

  // Table-browse rows only — authored console SQL runs through `useSqlRuns`
  // below (run-scoped, uncached, never retried), so its results and errors are
  // keyed to each individual run.
  const tableRowsQuery = useQueryRows({
    resourceId: resourceIdStr,
    sql: tableSql,
    limit: pageSize,
    enabled: mode === "table" && Boolean(selected),
    keepPrevious: true,
  });

  // Cell variants + FK targets + display types for the open table (table-browse
  // mode only).
  const { columnVariants, columnFks, columnTypes } = useTableColumnMeta({
    resourceId: resourceIdStr,
    table: selected,
    enabled: mode === "table",
  });

  // Inline edit / delete are offered only in table-browse mode, when the actor
  // has the write capability and the open table has a primary key to target.
  const canWrite = useDataCapabilities(resourceIdStr).data?.canWrite ?? false;
  const primaryKey = useTablePrimaryKey({
    resourceId: resourceIdStr,
    table: selected,
    enabled: mode === "table" && canWrite,
  });
  const editable = mode === "table" && canWrite && Boolean(selected);
  const { onUpdateRow, onDeleteRow } = useRowMutations(resourceIdStr, selected, tableRowsQuery);

  // SQL-console execution log (browser-local ring, successes and failures).
  const history = useQueryHistory(resourceIdStr);
  const recordHistory = history.record;

  // Authored-SQL run model (read-only `database.query` / audited
  // `database.execute`, both run-scoped — see ./use-data-studio-sql). A
  // successful write refreshes the table list + open rows so DDL/DML shows up.
  const { run, startRead, startWrite, writeRunning } = useSqlRuns({
    resourceId: resourceIdStr,
    recordHistory,
    onWriteSuccess: () => {
      void tablesQuery.refetch();
      void tableRowsQuery.refetch();
    },
  });

  // Write mode → audited `database.execute` behind a confirm (typed-phrase
  // gate for destructive statements). Stages the exact statement text and runs
  // that same text on confirm — never re-reads the editor. See
  // ./use-data-studio-sql.
  const { pendingWrite, stageWrite, cancelPendingWrite, confirmPendingWrite } = useWriteConfirm({
    runWrite: startWrite,
  });

  // Shared table-switch plumbing: reset paging/view state and pull the
  // persisted column-visibility prefs for the newly opened table.
  function switchToTable(t: TableRef) {
    setSelected(t);
    setMode("table");
    setTableView("data");
    setPage(0);
    setHiddenColumnsState(loadHiddenColumns(resourceIdStr, t));
  }

  // Jump to a referenced table, pre-filtered to the row (from a FK popover).
  function openRefTable(fk: FkTarget, value: string) {
    const target = tables.find((t) => t.schema === fk.schema && t.name === fk.table);
    if (!target) return;
    switchToTable(target);
    setFilters([{ ...newFilter(), column: fk.column, op: "eq", value }]);
  }

  const setHiddenColumns = (next: string[]) => {
    setHiddenColumnsState(next);
    if (selected) saveHiddenColumns(resourceIdStr, selected, next);
  };

  const schema = buildSchema(tables, selected, columnVariants);

  const openTable = (t: TableRef) => {
    switchToTable(t);
    setFilters([]);
  };
  // Switch back to the (primary) table-browse view from the SQL playground.
  const backToTable = () => {
    if (!selected && tables.length > 0) openTable(tables[0] as TableRef);
    else setMode("table");
  };
  const changeFilters = (next: Filter[]) => {
    setFilters(next);
    setPage(0);
  };

  // Run authored SQL: write mode stages the statement behind the confirm
  // dialog; the read-only query path runs immediately as a fresh run (Run
  // again on the same text starts a new run rather than reusing a cache entry
  // — see ./use-data-studio-sql).
  const runSql = (sqlText: string) => {
    const trimmed = sqlText.trim();
    if (!trimmed) return;
    setMode("sql");

    if (writeMode && canWrite) {
      stageWrite(trimmed);
      return;
    }

    startRead(trimmed);
  };

  // Land on the first table's rows once the list loads (browse, not authored
  // SQL). Fires once so it never fights a manual SQL/snippet switch afterward.
  useEffect(() => {
    if (!autoOpenedRef.current && !selected && tables[0]) {
      autoOpenedRef.current = true;
      openTable(tables[0]);
    }
  }, [selected, tables, openTable]);

  // Results pane source: the table-browse query in table mode, the current
  // run's outcome in SQL mode. Each is keyed to its own source (react-query
  // cache vs. the latest run id), so a stale error from an earlier statement
  // can never render under a newer one — see ./use-data-studio-sql.
  const result = mode === "table" ? (tableRowsQuery.data ?? null) : (run?.result ?? null);
  const hasNext = hasNextPage(mode, result);
  const rowsQuery =
    mode === "table"
      ? tableRowsQuery
      : {
          isLoading: run?.status === "running",
          isFetching: run?.status === "running",
          isError: run?.status === "error",
          error: run?.error ?? null,
          data: run?.result ?? undefined,
          refetch: () => {
            if (run) startRead(run.sql);
          },
        };

  return {
    resourceId,
    mode,
    setMode,
    tableSearch,
    setTableSearch,
    selected,
    page,
    setPage,
    pageSize,
    setPageSize,
    filters,
    view,
    setView,
    tableView,
    setTableView,
    writeMode,
    setWriteMode,
    hiddenColumns,
    setHiddenColumns,
    tablesQuery,
    tables,
    filteredTables,
    where,
    rowsQuery,
    result,
    hasNext,
    columnVariants,
    columnFks,
    columnTypes,
    canWrite,
    primaryKey,
    editable,
    // Toolbar only reads `.isPending` (disables the Write switch mid-run and
    // swaps its label) — see studio-sql-toolbar.tsx.
    executeSql: { isPending: writeRunning },
    onUpdateRow,
    onDeleteRow,
    openRefTable,
    schema,
    openTable,
    backToTable,
    changeFilters,
    runSql,
    pendingWrite,
    confirmPendingWrite,
    cancelPendingWrite,
    history,
  };
}

export function useDataStudio(resource: Resource, shortcuts: boolean) {
  const editor = useSnippetBuffer(String(resource.resourceId));
  const table = useTableData(resource);

  const [showLeft, setShowLeft] = useState(true);
  // The schema explorer is opt-in — closed until toggled from the toolbar.
  const [showRight, setShowRight] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  const selectSnippet = (id: string) => {
    editor.setActiveSnippetId(id);
    table.setMode("sql");
  };
  const newQuery = () => {
    const s = editor.addSnippet({ name: "Untitled query", sql: "" });
    selectSnippet(s.id);
  };
  const openInSql = () => {
    const sel = table.selected;
    if (!sel) return;
    const q = `SELECT * FROM "${sel.schema}"."${sel.name}"${table.where} LIMIT ${table.pageSize};`;
    const s = editor.addSnippet({ name: `${sel.name} query`, sql: q, folderId: null });
    selectSnippet(s.id);
    table.runSql(q);
  };
  // History → editor: load into the Playground buffer (never overwrite a named
  // snippet out from under the user) and switch to the SQL view.
  const loadFromHistory = (sql: string) => {
    editor.loadIntoPlayground(sql);
    table.setMode("sql");
  };

  // ⌘K — only the visible studio listens (`enabled` is synced every render).
  // The global command palette also registers Mod+K (features/command-palette);
  // that's intentional — this one only fires while the Data studio is mounted
  // and `shortcuts` is enabled, so `conflictBehavior: "allow"` silences the
  // (correct, but noisy on every load) "already registered" console warning
  // instead of the two hooks racing to unregister each other.
  useHotkey(
    "Mod+K",
    (event) => {
      event.preventDefault();
      setSpotlightOpen((o) => !o);
    },
    { enabled: shortcuts, conflictBehavior: "allow" },
  );

  return {
    editor,
    table,
    showLeft,
    setShowLeft,
    showRight,
    setShowRight,
    spotlightOpen,
    setSpotlightOpen,
    selectSnippet,
    newQuery,
    openInSql,
    loadFromHistory,
  };
}

export type DataStudioController = ReturnType<typeof useDataStudio>;
