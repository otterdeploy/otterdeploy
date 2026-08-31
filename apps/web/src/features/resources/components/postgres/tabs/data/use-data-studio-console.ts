/**
 * The authored-SQL half of {@link useTableData}: the console's history + run
 * lifecycle + write confirm composed into one hook, and the rule that decides
 * which source the results pane renders from.
 *
 * Split out of use-data-studio.ts because the table controller was carrying two
 * unrelated concerns at once (browsing a table and running console SQL) and
 * the second one is what pushed it past both the line and complexity caps. The
 * run/confirm hooks are called here in the same order they were called there, so
 * the controller's hook sequence is unchanged.
 */

import type { WorkbenchTarget } from "./data/target";

import { useQueryHistory } from "./data/query-history";
import { targetKey } from "./data/target";
import { type useBrowseRows } from "./data/use-database";
import { hasNextPage } from "./use-data-studio-helpers";
import { type SqlRunState, useSqlRuns, useWriteConfirm } from "./use-data-studio-sql";

type TableRowsQuery = ReturnType<typeof useBrowseRows>;

/**
 * Owns everything the SQL console needs: the browser-local execution log, the
 * run model (read-only `database.query` / audited `database.execute`, both
 * run-scoped. See ./use-data-studio-sql), and the write-mode confirm gate.
 *
 * `runSql` is the single entry point the views call: write mode stages the
 * statement behind the confirm dialog; the read-only path runs immediately as a
 * fresh run (Run again on the same text starts a new run rather than reusing a
 * cache entry).
 */
export function useSqlConsole({
  target,
  canWrite,
  writeMode,
  setMode,
  onWriteSuccess,
}: {
  target: WorkbenchTarget;
  /** The actor holds `database:write`. Write mode is inert without it. */
  canWrite: boolean;
  /** The Write toggle is on (staged + audited execution instead of a query). */
  writeMode: boolean;
  setMode: (mode: "table" | "sql") => void;
  /** A write landed. The caller refreshes anything DDL/DML could have changed. */
  onWriteSuccess: () => void;
}) {
  // SQL-console execution log (browser-local ring, successes and failures).
  const history = useQueryHistory(targetKey(target));
  const recordHistory = history.record;

  const { run, startRead, startWrite, writeRunning } = useSqlRuns({
    target,
    recordHistory,
    onWriteSuccess,
  });

  // Write mode → audited `database.execute` behind a confirm (typed-phrase
  // gate for destructive statements). Stages the exact statement text and runs
  // that same text on confirm, never re-reads the editor.
  const { pendingWrite, stageWrite, cancelPendingWrite, confirmPendingWrite } = useWriteConfirm({
    runWrite: startWrite,
  });

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

  return {
    history,
    run,
    startRead,
    writeRunning,
    pendingWrite,
    confirmPendingWrite,
    cancelPendingWrite,
    runSql,
  };
}

/**
 * Results-pane source: the table-browse query in table mode, the current run's
 * outcome in SQL mode, adapted to the same query-ish shape the pane consumes.
 *
 * Each is keyed to its own source (react-query cache vs. the latest run id), so
 * a stale error from an earlier statement can never render under a newer one.
 * See ./use-data-studio-sql.
 */
export function resolveStudioResults(
  mode: "table" | "sql",
  tableRowsQuery: TableRowsQuery,
  run: SqlRunState | null,
  startRead: (sql: string) => void,
) {
  const result = mode === "table" ? (tableRowsQuery.data ?? null) : (run?.result ?? null);
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

  return { result, hasNext: hasNextPage(mode, result), rowsQuery };
}
