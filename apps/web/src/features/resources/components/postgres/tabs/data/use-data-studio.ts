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

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";

import type { FkTarget } from "@/shared/components/data-grid/types";

import type { PostgresBodyProps } from "../../types";
import type { ResultView } from "./components/results-panel";

import { loadHiddenColumns, saveHiddenColumns } from "./data/column-prefs";
import { buildWhere, type Filter, newFilter } from "./data/filters";
import { browseRowsSql, type TableRef } from "./data/queries";
import { useQueryRows } from "./data/use-database";
import { resolveStudioResults, useSqlConsole } from "./use-data-studio-console";
import { buildSchema, useRowMutations, useSnippetBuffer } from "./use-data-studio-helpers";
import { errMessage } from "./use-data-studio-sql";
import { useOpenTableAccess, useTableList } from "./use-data-studio-tables";

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

  const { tablesQuery, tables, filteredTables } = useTableList(resourceIdStr, tableSearch);

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

  // Column metadata + write access for the open table — see
  // ./use-data-studio-tables.
  const { columnVariants, columnFks, columnTypes, canWrite, primaryKey, editable } =
    useOpenTableAccess({ resourceId: resourceIdStr, table: selected, mode });

  const { onUpdateRow, onDeleteRow } = useRowMutations(resourceIdStr, selected, tableRowsQuery);

  // Authored-SQL console: history + run model + write confirm + `runSql`. A
  // successful write refreshes the table list + open rows so DDL/DML shows up.
  // See ./use-data-studio-console.
  const {
    history,
    run,
    startRead,
    writeRunning,
    pendingWrite,
    confirmPendingWrite,
    cancelPendingWrite,
    runSql,
  } = useSqlConsole({
    resourceId: resourceIdStr,
    canWrite,
    writeMode,
    setMode,
    onWriteSuccess: () => {
      void tablesQuery.refetch();
      void tableRowsQuery.refetch();
    },
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

  // Land on the first table's rows once the list loads (browse, not authored
  // SQL). Fires once so it never fights a manual SQL/snippet switch afterward.
  // `openTable` is a fresh closure every render, so it reaches the effect as an
  // effect event rather than a dependency that would re-run it constantly.
  const autoOpen = useEffectEvent((t: TableRef) => openTable(t));
  useEffect(() => {
    if (!autoOpenedRef.current && !selected && tables[0]) {
      autoOpenedRef.current = true;
      autoOpen(tables[0]);
    }
  }, [selected, tables]);

  // Results pane source — see ./use-data-studio-console.
  const { result, hasNext, rowsQuery } = resolveStudioResults(mode, tableRowsQuery, run, startRead);

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

  // The SQL playground is a three-pane resizable shell. On a phone a 20% rail
  // is ~75px — too narrow to read a snippet name and it starves the editor, so
  // the snippets rail starts closed below `md`. The toolbar toggle still opens
  // it on demand; only the DEFAULT differs.
  const [showLeft, setShowLeft] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 768,
  );
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
