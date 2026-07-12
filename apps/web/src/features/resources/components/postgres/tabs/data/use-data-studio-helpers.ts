/**
 * Smaller building blocks for {@link useDataStudio}: the editor/snippet buffer
 * hook, the inline row-mutation hook, and the pure derivations (autocomplete
 * schema, active SQL, has-next-page). Kept here so the controller file stays
 * within size + complexity budgets.
 */

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";
import { format as formatSql } from "sql-formatter";

import type { ColumnValue } from "./components/dice-grid";
import type { TableRef } from "./data/queries";

import { useMutateRow } from "./data/use-database";
import { PLAYGROUND_ID, useSqlSnippets } from "./data/use-sql-snippets";

/** Autocomplete schema: every table name, plus columns of the open table. */
export function buildSchema(
  tables: readonly { name: string }[],
  selected: TableRef | null,
  columnVariants: Record<string, unknown>,
): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const t of tables) m[t.name] = [];
  if (selected) {
    const cols = Object.keys(columnVariants);
    if (cols.length) m[selected.name] = cols;
  }
  return m;
}

/** The SQL the results pane runs: the table-browse query in table mode, the
 *  last authored statement in SQL mode. */
export function activeSqlFor(
  mode: "table" | "sql",
  tableSql: string,
  ranSql: string | null,
): string {
  return mode === "table" ? tableSql : (ranSql ?? "");
}

/** Whether table-browse mode has another page (the +1 sentinel row was hit). */
export function hasNextPage(
  mode: "table" | "sql",
  result: { truncated?: boolean } | null | undefined,
): boolean {
  return mode === "table" && (result?.truncated ?? false);
}

export function useSnippetBuffer(resourceId: string) {
  const [activeSnippetId, setActiveSnippetId] = useState<string>(PLAYGROUND_ID);

  const {
    folders,
    snippets,
    playground,
    setPlayground,
    addFolder,
    renameFolder,
    deleteFolder,
    addSnippet,
    updateSnippet,
    deleteSnippet,
  } = useSqlSnippets(resourceId);

  // Resolve the editor buffer from the active snippet; fall back to Playground
  // if the snippet was deleted out from under us.
  const activeSnippet =
    activeSnippetId === PLAYGROUND_ID ? null : snippets.find((s) => s.id === activeSnippetId);
  useEffect(() => {
    if (activeSnippetId !== PLAYGROUND_ID && !activeSnippet) {
      setActiveSnippetId(PLAYGROUND_ID);
    }
  }, [activeSnippetId, activeSnippet]);
  const editorValue = activeSnippetId === PLAYGROUND_ID ? playground : (activeSnippet?.sql ?? "");

  const onEditorChange = (v: string) => {
    if (activeSnippetId === PLAYGROUND_ID) setPlayground(v);
    else updateSnippet(activeSnippetId, { sql: v });
  };

  const prettify = () => {
    try {
      onEditorChange(formatSql(editorValue, { language: "postgresql", keywordCase: "upper" }));
    } catch {
      /* leave the buffer untouched on parse error */
    }
  };

  // Replace the Playground buffer and make it active (query-history recall).
  // Deliberately never writes into a named snippet.
  const loadIntoPlayground = (sql: string) => {
    setPlayground(sql);
    setActiveSnippetId(PLAYGROUND_ID);
  };

  return {
    folders,
    snippets,
    addFolder,
    renameFolder,
    deleteFolder,
    addSnippet,
    updateSnippet,
    deleteSnippet,
    activeSnippetId,
    setActiveSnippetId,
    editorValue,
    onEditorChange,
    prettify,
    loadIntoPlayground,
  };
}

export interface BulkDeleteProgress {
  done: number;
  total: number;
}

/**
 * Multi-select bulk delete: sequential `mutateRow` deletes (one audited,
 * primary-key-guarded statement per row — never a client-built IN list), with
 * progress and a partial-failure report. Rows are addressed as indices into the
 * current result page; the PK predicate is read from the result grid itself.
 */
export function useBulkDelete({
  resourceId,
  selected,
  primaryKey,
  result,
  rowsQuery,
}: {
  resourceId: string;
  selected: TableRef | null;
  primaryKey: string[];
  result: { columns: string[]; rows: (string | null)[][] } | null | undefined;
  rowsQuery: { refetch: () => unknown };
}) {
  const mutateRow = useMutateRow();
  const [progress, setProgress] = useState<BulkDeleteProgress | null>(null);

  const deleteRows = useCallback(
    async (rowIndices: number[]) => {
      if (!selected || !result || primaryKey.length === 0 || rowIndices.length === 0) return;
      const pkIdx = primaryKey.map((c) => result.columns.indexOf(c));
      if (pkIdx.some((i) => i === -1)) return; // PK column hidden from the result? refuse.

      setProgress({ done: 0, total: rowIndices.length });
      let failed = 0;
      let firstError: string | null = null;
      for (const [i, rowIndex] of rowIndices.entries()) {
        const row = result.rows[rowIndex];
        if (!row) {
          failed += 1;
        } else {
          const pk = primaryKey.map((c, k) => ({
            column: c,
            value: row[pkIdx[k] ?? -1] ?? null,
          }));
          try {
            await mutateRow.mutateAsync({
              resourceId: resourceId as never,
              schema: selected.schema,
              table: selected.name,
              op: "delete",
              pk,
              set: [],
            });
          } catch (err) {
            failed += 1;
            if (!firstError) firstError = err instanceof Error ? err.message : String(err);
          }
        }
        setProgress({ done: i + 1, total: rowIndices.length });
      }
      setProgress(null);
      void rowsQuery.refetch();

      const ok = rowIndices.length - failed;
      if (failed === 0) {
        toast.success(`Deleted ${ok} row${ok === 1 ? "" : "s"}`);
      } else {
        toast.error(
          `Deleted ${ok} of ${rowIndices.length} rows — ${failed} failed` +
            (firstError ? `: ${firstError}` : ""),
        );
      }
    },
    [selected, result, primaryKey, mutateRow, resourceId, rowsQuery],
  );

  return { deleteRows, progress };
}

/** Inline edit / delete against the open table (table-browse mode, write-capable). */
export function useRowMutations(
  resourceId: string,
  selected: TableRef | null,
  rowsQuery: { refetch: () => unknown },
) {
  const mutateRow = useMutateRow();

  const onUpdateRow = useCallback(
    async (pk: ColumnValue[], set: ColumnValue[]) => {
      if (!selected) return;
      await mutateRow.mutateAsync({
        resourceId: resourceId as never,
        schema: selected.schema,
        table: selected.name,
        op: "update",
        pk,
        set,
      });
      // Reconcile with server truth (triggers / computed columns / defaults).
      void rowsQuery.refetch();
    },
    [selected, mutateRow, resourceId, rowsQuery],
  );

  const onDeleteRow = useCallback(
    async (pk: ColumnValue[]) => {
      if (!selected) return;
      await mutateRow.mutateAsync({
        resourceId: resourceId as never,
        schema: selected.schema,
        table: selected.name,
        op: "delete",
        pk,
        set: [],
      });
      void rowsQuery.refetch();
    },
    [selected, mutateRow, resourceId, rowsQuery],
  );

  return { onUpdateRow, onDeleteRow };
}
