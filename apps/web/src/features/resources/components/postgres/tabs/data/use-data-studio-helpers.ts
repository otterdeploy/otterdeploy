/**
 * Smaller building blocks for {@link useDataStudio}: the editor/snippet buffer
 * hook, the inline row-mutation hook, and the pure derivations (autocomplete
 * schema, active SQL, has-next-page). Kept here so the controller file stays
 * within size + complexity budgets.
 */

import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";

import { useState } from "react";

import { Result } from "better-result";
import { toast } from "sonner";
import { format as formatSql } from "sql-formatter";

import type { ColumnValue } from "./components/dice-grid";
import type { TableRef } from "./data/queries";

import { useMutateRows } from "./data/use-database";
import { PLAYGROUND_ID, useSqlSnippets } from "./data/use-sql-snippets";

/** Autocomplete schema: every table name, plus columns of the open table. */
export function buildSchema(
  tables: readonly { name: string }[],
  selected: TableRef | null,
  columns: readonly ColumnMeta[],
): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const t of tables) m[t.name] = [];
  if (selected && columns.length > 0) m[selected.name] = columns.map((c) => c.name);
  return m;
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
  // Corrected during render (not an effect) so the buffer never paints a stale
  // value for a snippet that was deleted out from under us; the guard resolves
  // itself once we're back on Playground, so there's no render loop.
  if (activeSnippetId !== PLAYGROUND_ID && !activeSnippet) {
    setActiveSnippetId(PLAYGROUND_ID);
  }
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

/**
 * Deleting several selected rows AS ONE TRANSACTION.
 *
 * The version this replaces fired one `database.mutateRow` per row and counted
 * the casualties: "Deleted 7 of 10 rows, 3 failed" left the table in a state
 * nobody asked for and no undo could reach. A foreign-key violation on row 8 is
 * not a reason to have already deleted rows 1 through 7.
 *
 * There is no progress bar any more because there is no longer any progress to
 * report: the whole delete lands or none of it does.
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
  result: { columns: ColumnMeta[]; rows: CellValue[][] } | null | undefined;
  rowsQuery: { refetch: () => unknown };
}) {
  const mutateRows = useMutateRows(resourceId);

  const deleteRows = async (rowIndices: number[]) => {
    if (!selected || !result || primaryKey.length === 0 || rowIndices.length === 0) return;
    const pkIdx = primaryKey.map((c) => result.columns.findIndex((col) => col.name === c));
    // A hidden primary-key column means we cannot identify the rows. Refusing
    // is the only safe answer; guessing would delete something else.
    if (pkIdx.some((i) => i === -1)) return;

    const mutations = rowIndices.flatMap((rowIndex) => {
      const row = result.rows[rowIndex];
      if (!row) return [];
      return [
        {
          op: "delete" as const,
          schema: selected.schema,
          table: selected.name,
          pk: primaryKey.map((column, k) => ({ column, value: row[pkIdx[k] ?? -1] ?? null })),
          set: [],
        },
      ];
    });
    if (mutations.length === 0) return;

    const outcome = await Result.tryPromise({
      try: () => mutateRows.mutateAsync({ resourceId, mutations }),
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    });
    void rowsQuery.refetch();

    if (outcome.isErr()) {
      toast.error(`Nothing was deleted: ${outcome.error}`);
      return;
    }
    const n = outcome.value.rowsAffected;
    toast.success(`Deleted ${n} row${n === 1 ? "" : "s"}`);
  };

  return { deleteRows, isDeleting: mutateRows.isPending };
}

/** Inline edit / delete against the open table (table-browse mode, write-capable). */
export function useRowMutations(
  resourceId: string,
  selected: TableRef | null,
  rowsQuery: { refetch: () => unknown },
) {
  const mutateRows = useMutateRows(resourceId);

  const onUpdateRow = async (pk: ColumnValue[], set: ColumnValue[]) => {
    if (!selected) return;
    await mutateRows.mutateAsync({
      resourceId,
      mutations: [{ op: "update", schema: selected.schema, table: selected.name, pk, set }],
    });
    // Reconcile with server truth (triggers / computed columns / defaults).
    void rowsQuery.refetch();
  };

  const onDeleteRow = async (pk: ColumnValue[]) => {
    if (!selected) return;
    await mutateRows.mutateAsync({
      resourceId,
      mutations: [{ op: "delete", schema: selected.schema, table: selected.name, pk, set: [] }],
    });
    void rowsQuery.refetch();
  };

  return { onUpdateRow, onDeleteRow };
}
