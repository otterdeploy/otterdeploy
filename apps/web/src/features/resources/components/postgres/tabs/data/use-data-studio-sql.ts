/**
 * SQL-console side hooks for {@link useDataStudio}'s table controller: the
 * history logger for read-path runs and the confirmed write path (pendingWrite
 * → audited `database.execute`). Pulled out of `use-data-studio.ts` so the
 * controller file stays within size budgets — behavior is unchanged.
 */

import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import type { QueryHistoryEntry } from "./data/query-history";

import { classifyWriteSql, type WriteSeverity } from "./data/destructive-sql";
import { SQL_RESULT_CAP } from "./data/queries";
import { useExecuteSql } from "./data/use-database";

type RecordHistory = (e: Omit<QueryHistoryEntry, "id" | "at">) => void;

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

/**
 * Record read-path console runs once each time a result (or error) lands.
 * Keyed on react-query's update stamps so a re-run of the same statement is
 * logged again while a mere re-render is not. Table-browse queries are NOT
 * history — only authored SQL.
 */
export function useSqlHistoryLog({
  mode,
  ranSql,
  rowsQuery,
  recordHistory,
}: {
  mode: "table" | "sql";
  ranSql: string | null;
  rowsQuery: {
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    isError: boolean;
    data: { rowCount: number; durationMs: number } | undefined;
    error: unknown;
  };
  recordHistory: RecordHistory;
}) {
  const lastHistoryKeyRef = useRef("");
  const historyStamp = Math.max(rowsQuery.dataUpdatedAt, rowsQuery.errorUpdatedAt);
  useEffect(() => {
    if (mode !== "sql" || !ranSql || historyStamp === 0) return;
    const key = `${historyStamp}:${ranSql}`;
    if (key === lastHistoryKeyRef.current) return;
    lastHistoryKeyRef.current = key;
    const failed = rowsQuery.errorUpdatedAt >= rowsQuery.dataUpdatedAt && rowsQuery.isError;
    recordHistory({
      sql: ranSql,
      ok: !failed,
      rowCount: failed ? null : (rowsQuery.data?.rowCount ?? null),
      durationMs: failed ? null : (rowsQuery.data?.durationMs ?? null),
      error: failed ? errMessage(rowsQuery.error) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyStamp, mode, ranSql, recordHistory]);
}

/**
 * Write mode → run arbitrary SQL through the audited `database.execute` path,
 * behind a styled confirm dialog (typed-phrase gate when the statement is
 * destructive). Refreshes the schema + open rows afterward so DDL/DML is
 * reflected. The read-only query path stays the default.
 */
export function useWriteConfirm({
  resourceId,
  tablesQuery,
  rowsQuery,
  recordHistory,
}: {
  resourceId: string;
  tablesQuery: { refetch: () => unknown };
  rowsQuery: { refetch: () => unknown };
  recordHistory: RecordHistory;
}) {
  // Write-mode statement awaiting confirmation. Destructive statements
  // (DROP/TRUNCATE/unscoped DELETE/UPDATE) get a type-the-db-name gate in the
  // dialog; other writes a plain styled confirm. See ./data/destructive-sql.
  const [pendingWrite, setPendingWrite] = useState<{
    sql: string;
    severity: WriteSeverity;
  } | null>(null);

  const executeSql = useExecuteSql();

  const stageWrite = (sql: string) => setPendingWrite({ sql, severity: classifyWriteSql(sql) });
  const cancelPendingWrite = () => setPendingWrite(null);
  const confirmPendingWrite = () => {
    if (!pendingWrite) return;
    const sql = pendingWrite.sql;
    setPendingWrite(null);
    executeSql.mutate(
      { resourceId: resourceId as never, sql, limit: SQL_RESULT_CAP },
      {
        onSuccess: (res) => {
          toast.success(
            `Statement ran — ${res.rowCount} row${res.rowCount === 1 ? "" : "s"} affected`,
          );
          recordHistory({
            sql,
            ok: true,
            rowCount: res.rowCount,
            durationMs: res.durationMs,
            error: null,
          });
          void tablesQuery.refetch();
          void rowsQuery.refetch();
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Statement failed");
          recordHistory({
            sql,
            ok: false,
            rowCount: null,
            durationMs: null,
            error: errMessage(err),
          });
        },
      },
    );
  };

  return { pendingWrite, stageWrite, executeSql, cancelPendingWrite, confirmPendingWrite };
}
