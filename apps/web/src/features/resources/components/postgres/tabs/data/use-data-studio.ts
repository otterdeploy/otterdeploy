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

import { useEffect, useMemo, useRef, useState } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "sonner";

import type { FkTarget } from "@/shared/components/data-grid/types";

import type { PostgresBodyProps } from "../../types";
import type { ResultView } from "./components/results-panel";

import { buildWhere, type Filter, newFilter } from "./data/filters";
import { browseRowsSql, SQL_RESULT_CAP, type TableRef } from "./data/queries";
import {
  useDataCapabilities,
  useDatabaseTables,
  useExecuteSql,
  useQueryRows,
  useTableColumnMeta,
  useTablePrimaryKey,
} from "./data/use-database";
import {
  activeSqlFor,
  buildSchema,
  hasNextPage,
  useRowMutations,
  useSnippetBuffer,
} from "./use-data-studio-helpers";

type Resource = PostgresBodyProps["resource"];

export const PAGE_SIZES = [50, 100, 200, 500];

/** Pull the human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to the message. */
export function errMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: { reason?: unknown } }).data;
    if (data && typeof data.reason === "string") return data.reason;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}

function useTableData(resource: Resource) {
  const resourceId = resource.resourceId as never;
  const resourceIdStr = String(resource.resourceId);

  const [mode, setMode] = useState<"table" | "sql">("table");
  const [tableSearch, setTableSearch] = useState("");
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [ranSql, setRanSql] = useState<string | null>(null);
  const [view, setView] = useState<ResultView>("grid");
  const [writeMode, setWriteMode] = useState(false);
  const autoOpenedRef = useRef(false);

  const tablesQuery = useDatabaseTables(resourceIdStr);
  const tables = tablesQuery.data?.tables ?? [];
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q));
  }, [tableSearch]);

  const where = buildWhere(filters);
  const tableSql = selected ? browseRowsSql(selected, where, pageSize + 1, page * pageSize) : "";
  const activeSql = activeSqlFor(mode, tableSql, ranSql);

  const rowsQuery = useQueryRows({
    resourceId: resourceIdStr,
    sql: activeSql,
    limit: mode === "table" ? pageSize : SQL_RESULT_CAP,
    enabled: mode === "table" ? Boolean(selected) : Boolean(ranSql),
    keepPrevious: mode === "table",
  });
  const result = rowsQuery.data;
  const hasNext = hasNextPage(mode, result);

  // Cell variants + FK targets for the open table (table-browse mode only).
  const { columnVariants, columnFks } = useTableColumnMeta({
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
  const executeSql = useExecuteSql();
  const { onUpdateRow, onDeleteRow } = useRowMutations(resourceIdStr, selected, rowsQuery);

  // Jump to a referenced table, pre-filtered to the row (from a FK popover).
  function openRefTable(fk: FkTarget, value: string) {
    const target = tables.find((t) => t.schema === fk.schema && t.name === fk.table);
    if (!target) return;
    setSelected(target);
    setMode("table");
    setPage(0);
    setFilters([{ ...newFilter(), column: fk.column, op: "eq", value }]);
  }

  const schema = useMemo(
    () => buildSchema(tables, selected, columnVariants),
    [selected, columnVariants],
  );

  const openTable = (t: TableRef) => {
    setSelected(t);
    setMode("table");
    setPage(0);
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

  // Write mode → run arbitrary SQL through the audited `database.execute` path,
  // behind a confirm. Refreshes the schema + open rows afterward so DDL/DML is
  // reflected. The read-only query path stays the default.
  const runSql = (sqlText: string) => {
    const trimmed = sqlText.trim();
    if (!trimmed) return;
    setMode("sql");

    if (writeMode && canWrite) {
      if (
        !window.confirm(
          "Run this against the live database? INSERT / UPDATE / DELETE / DDL take effect immediately and can't be undone.",
        )
      ) {
        return;
      }
      executeSql.mutate(
        { resourceId: resourceIdStr, sql: trimmed, limit: SQL_RESULT_CAP },
        {
          onSuccess: (res) => {
            toast.success(
              `Statement ran — ${res.rowCount} row${res.rowCount === 1 ? "" : "s"} affected`,
            );
            void tablesQuery.refetch();
            void rowsQuery.refetch();
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Statement failed"),
        },
      );
      return;
    }

    if (trimmed === ranSql) void rowsQuery.refetch();
    else setRanSql(trimmed);
  };

  // Land on the first table's rows once the list loads (browse, not authored
  // SQL). Fires once so it never fights a manual SQL/snippet switch afterward.
  useEffect(() => {
    if (!autoOpenedRef.current && !selected && tables[0]) {
      autoOpenedRef.current = true;
      openTable(tables[0]);
    }
  }, [selected]);

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
    writeMode,
    setWriteMode,
    tablesQuery,
    tables,
    filteredTables,
    where,
    rowsQuery,
    result,
    hasNext,
    columnVariants,
    columnFks,
    canWrite,
    primaryKey,
    editable,
    executeSql,
    onUpdateRow,
    onDeleteRow,
    openRefTable,
    schema,
    openTable,
    backToTable,
    changeFilters,
    runSql,
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

  // ⌘K — only the visible studio listens (`enabled` is synced every render).
  useHotkey(
    "Mod+K",
    (event) => {
      event.preventDefault();
      setSpotlightOpen((o) => !o);
    },
    { enabled: shortcuts },
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
  };
}

export type DataStudioController = ReturnType<typeof useDataStudio>;
