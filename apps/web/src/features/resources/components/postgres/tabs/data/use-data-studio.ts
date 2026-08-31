/**
 * State + actions controller for the Data studio. Splits the (large) studio
 * into composable hooks so each stays small: {@link useSnippetBuffer} owns the
 * editor buffer + snippet store, {@link useTableData} owns the table-browse +
 * query + write path, and {@link useDataStudio} composes them and wires the
 * cross-cutting actions (snippet selection, open-in-SQL, the ⌘K spotlight).
 *
 * The editor imperative handle (`editorRef`) is intentionally NOT part of the
 * returned controller. Keeping a ref out of the shared object stops the views
 * from tripping the "no ref access during render" rule. The owning component
 * holds the ref and passes it to the SQL view + spotlight directly.
 *
 * The presentational views (table browser / SQL playground / results panel)
 * consume the returned {@link DataStudioController}.
 */

import type { Filter, Sort } from "@otterdeploy/data-engine";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";

import type { FkTarget } from "@/shared/components/data-grid/types";

import type { DefinitionsSection } from "./components/definitions-view";
import type { ResultView } from "./components/results-panel";
import type { WorkbenchTarget } from "./data/target";
import type { WorkbenchUrlState } from "./data/url-state";

import { loadHiddenColumns, saveHiddenColumns } from "./data/column-prefs";
import { type TableRef } from "./data/queries";
import { targetKey } from "./data/target";
import { EMPTY_URL_STATE, useWorkbenchUrlSync } from "./data/url-state";
import { useBrowseRows } from "./data/use-database";
import { resolveStudioResults, useSqlConsole } from "./use-data-studio-console";
import {
  buildSchema,
  quoteRef,
  useDrafts,
  useRowMutations,
  useSnippetBuffer,
} from "./use-data-studio-helpers";
import { errMessage } from "./use-data-studio-sql";
import { useOpenTableAccess, useTableList } from "./use-data-studio-tables";
import { useWorkbenchTabs } from "./use-workbench-tabs";

export const PAGE_SIZES = [50, 100, 200, 500];

export { errMessage };

function useTableData(target: WorkbenchTarget, init: WorkbenchUrlState) {
  const [mode, setMode] = useState<"table" | "sql">("table");
  const [tableSearch, setTableSearch] = useState("");
  // Seeded from the URL, so a refresh reopens the same table, page and
  // filters. See data/url-state.ts for the round trip.
  const [selected, setSelected] = useState<TableRef | null>(init.table);
  const [page, setPage] = useState(init.page);
  const [pageSize, setPageSize] = useState(init.pageSize);
  const [filters, setFilters] = useState<Filter[]>(init.filters);
  const [sorts, setSorts] = useState<Sort[]>(init.sorts);
  const [view, setView] = useState<ResultView>("grid");
  // Data (rows grid) vs Structure (column detail) for the open table.
  // Three read surfaces over the open connection: rows, this table's
  // columns, and the database's non-table objects.
  const [tableView, setTableView] = useState<"data" | "structure" | "definitions">("data");
  // Which Definitions section is open. Lifted out of DefinitionsView because
  // the rail lists Indexes/Constraints/Enums as destinations of their own —
  // clicking one has to both switch to Definitions and land on that section.
  const [definitionsSection, setDefinitionsSection] = useState<DefinitionsSection>("indexes");
  const [writeMode, setWriteMode] = useState(false);
  // Column names hidden from the grid for the open table (persisted per-table;
  // exports always include every column).
  const [hiddenColumns, setHiddenColumnsState] = useState<string[]>(() =>
    init.table === null ? [] : loadHiddenColumns(targetKey(target), init.table),
  );
  const autoOpenedRef = useRef(false);

  const { tablesQuery, tables, filteredTables, schemas, activeSchema, setActiveSchema } =
    useTableList(target, tableSearch);

  // The client sends a filter MODEL, not SQL. The server compiles it with the
  // operands bound and the column names checked against the table's real
  // columns, so neither can carry syntax into the statement.
  const tableRowsQuery = useBrowseRows({
    target,
    table: selected,
    filters,
    sorts,
    limit: pageSize,
    offset: page * pageSize,
    enabled: mode === "table",
    keepPrevious: true,
  });

  // Column metadata + write access for the open table. See
  // ./use-data-studio-tables.
  const { columns, columnVariants, columnFks, columnTypes, canWrite, primaryKey, editable } =
    useOpenTableAccess({ target, table: selected, mode });

  const { onDeleteRow } = useRowMutations(target, selected, tableRowsQuery);
  // Inline edits are STAGED, not written: see ./data/drafts.
  const drafts = useDrafts({ target, selected, rowsQuery: tableRowsQuery });

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
    target,
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
    setHiddenColumnsState(loadHiddenColumns(targetKey(target), t));
  }

  // Jump to a referenced table, pre-filtered to the row (from a FK popover).
  function openRefTable(fk: FkTarget, value: string) {
    const target = tables.find((t) => t.schema === fk.schema && t.name === fk.table);
    if (!target) return;
    switchToTable(target);
    setFilters([{ column: fk.column, op: "eq", values: [value], enabled: true }]);
  }

  const setHiddenColumns = (next: string[]) => {
    setHiddenColumnsState(next);
    if (selected) saveHiddenColumns(targetKey(target), selected, next);
  };

  const schema = buildSchema(tables, selected, columns);

  const openTable = (t: TableRef) => {
    switchToTable(t);
    setFilters([]);
  };
  // Switch back to the (primary) table-browse view from the SQL playground.
  const backToTable = () => {
    const first = filteredTables[0];
    if (!selected && first) openTable(first);
    else setMode("table");
  };
  // Both reset paging: page 3 of a different question is nowhere.
  const changeFilters = (next: Filter[]) => (setFilters(next), setPage(0));
  const changeSorts = (next: Sort[]) => (setSorts(next), setPage(0));

  // Land on the first table's rows once the list loads (browse, not authored
  // SQL). Fires once so it never fights a manual SQL/snippet switch afterward.
  // `openTable` is a fresh closure every render, so it reaches the effect as an
  // effect event rather than a dependency that would re-run it constantly.
  // The FILTERED list, not every table: the rail defaults to `public`, and
  // landing on a `drizzle` table that the rail is not showing leaves the
  // workbench open on something with no visible selection.
  const autoOpen = useEffectEvent((t: TableRef) => openTable(t));
  useEffect(() => {
    if (!autoOpenedRef.current && !selected && filteredTables[0]) {
      autoOpenedRef.current = true;
      autoOpen(filteredTables[0]);
    }
  }, [selected, filteredTables]);

  // Results pane source: see ./use-data-studio-console.
  const { result, hasNext, rowsQuery } = resolveStudioResults(mode, tableRowsQuery, run, startRead);

  return {
    target,
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
    definitionsSection,
    setDefinitionsSection,
    writeMode,
    setWriteMode,
    hiddenColumns,
    setHiddenColumns,
    tablesQuery,
    tables,
    filteredTables,
    schemas,
    activeSchema,
    setActiveSchema,
    columns,
    sorts,
    changeSorts,
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
    // swaps its label): see studio-sql-toolbar.tsx.
    executeSql: { isPending: writeRunning },
    drafts,
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

/**
 * The workbench, for one target.
 *
 * Takes a `WorkbenchTarget`, not a resource: since external connections exist
 * there is no resource behind half the things this can open, and the panel that
 * used to own this surface has no way to name them.
 */
export interface StudioOptions {
  /** Browse state decoded from the URL at mount. */
  init?: WorkbenchUrlState;
  /** Called whenever the browse state changes, to write it back to the URL. */
  onUrlState?: (state: WorkbenchUrlState) => void;
}

export function useDataStudio(
  target: WorkbenchTarget,
  shortcuts: boolean,
  options?: StudioOptions,
) {
  const editor = useSnippetBuffer(target);
  const table = useTableData(target, options?.init ?? EMPTY_URL_STATE);

  // The snippets panel starts closed: the workbench rail is the persistent
  // sidebar, and a second always-open panel beside it would double the chrome.
  // The toolbar toggle (and ⌘K) still opens it on demand.
  const [showLeft, setShowLeft] = useState(false);
  // The schema explorer is opt-in. Closed until toggled from the toolbar.
  const [showRight, setShowRight] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  const selectSnippet = (id: string) => {
    editor.setActiveSnippetId(id);
    table.setMode("sql");
  };
  // Open tables + open queries, one strip. Derives its active entry from the
  // state above, so every existing open path grows a tab without knowing.
  const tabs = useWorkbenchTabs({
    mode: table.mode,
    selected: table.selected,
    activeSnippetId: editor.activeSnippetId,
    snippetIds: editor.snippets.map((s) => s.id),
    openTable: table.openTable,
    selectSnippet,
  });
  const newQuery = () => {
    const s = editor.addSnippet({ name: "Untitled query", sql: "" });
    selectSnippet(s.id);
  };
  /**
   * Seed the editor with a runnable query for the open table.
   *
   * Deliberately WITHOUT the active filters. Those are a model the server
   * compiles with bound parameters; splicing their operands back into a string
   * here would reintroduce exactly the client-side SQL assembly this feature
   * just removed. The filter bar stays the place to express them, and the
   * editor starts from the unfiltered table.
   */
  const openInSql = () => {
    const sel = table.selected;
    if (!sel) return;
    const q = `SELECT * FROM ${quoteRef(sel)} LIMIT ${table.pageSize};`;
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

  useWorkbenchUrlSync(
    {
      table: table.selected,
      filters: table.filters,
      sorts: table.sorts,
      page: table.page,
      pageSize: table.pageSize,
    },
    options?.onUrlState,
  );

  // ⌘K: only the visible studio listens (`enabled` is synced every render).
  // The global command palette also registers Mod+K (features/command-palette);
  // that's intentional. This one only fires while the Data studio is mounted
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
    tabs,
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
