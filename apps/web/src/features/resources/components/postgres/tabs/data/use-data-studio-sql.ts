/**
 * SQL-console run model for {@link useDataStudio}'s table controller.
 *
 * Console runs are RUN-SCOPED, not cache-scoped: every Run press starts a fresh
 * run (a mutation, no react-query cache, no automatic retries) whose result or
 * error is stored under a monotonically increasing run id. The results pane
 * renders only the LATEST run's outcome, so a stale error from an earlier
 * statement can never render against a newer one, and a slow older run that
 * settles late can never clobber a newer run's result.
 *
 * The write path (pendingWrite → audited `database.execute`) stages the exact
 * statement text behind a confirm dialog; the confirmed run executes that exact
 * staged text and lands in the same run slot, so write results and errors render
 * in the results pane too (previously they only surfaced as toasts, leaving the
 * pane showing whatever the last read run produced).
 */

import { useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

import type { QueryHistoryEntry } from "./data/query-history";

import { classifyWriteSql, type WriteSeverity } from "./data/destructive-sql";
import { SQL_RESULT_CAP } from "./data/queries";

type RecordHistory = (e: Omit<QueryHistoryEntry, "id" | "at">) => void;

/** Pull the human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to the message. */
export function errMessage(error: unknown): string {
  if (error && typeof error === "object") {
    if ("data" in error) {
      const { data } = error;
      if (data && typeof data === "object" && "reason" in data && typeof data.reason === "string") {
        return data.reason;
      }
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "Something went wrong.";
}

/** The grid shape both `database.query` and `database.execute` return. */
export interface SqlRunResult {
  columns: string[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

/** One console run: the exact SQL sent, which path it took, and its outcome. */
export interface SqlRunState {
  id: number;
  sql: string;
  kind: "read" | "write";
  status: "running" | "ok" | "error";
  result: SqlRunResult | null;
  error: string | null;
}

/**
 * Owns the console's run lifecycle. `startRead` sends the statement through the
 * read-only `database.query` path; `startWrite` through the audited
 * `database.execute` path (writable session, DML/DDL take effect). Both record
 * a history entry exactly once, in the run's own settle callback.
 */
export function useSqlRuns({
  resourceId,
  recordHistory,
  onWriteSuccess,
}: {
  resourceId: string;
  recordHistory: RecordHistory;
  onWriteSuccess: () => void;
}) {
  const [run, setRun] = useState<SqlRunState | null>(null);
  const runSeq = useRef(0);

  const queryMutation = useMutation(orpc.database.query.mutationOptions());
  const executeMutation = useMutation(orpc.database.execute.mutationOptions());

  // Settle a run's outcome. Ignored unless it's still the latest run, so a
  // slow older request can never overwrite a newer run's state.
  const settle = (id: number, patch: Partial<SqlRunState>) => {
    setRun((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  };

  const start = (sql: string, kind: "read" | "write") => {
    const id = ++runSeq.current;
    setRun({ id, sql, kind, status: "running", result: null, error: null });
    const mutation = kind === "read" ? queryMutation : executeMutation;
    mutation.mutate(
      { resourceId, sql, limit: SQL_RESULT_CAP },
      {
        onSuccess: (res) => {
          settle(id, { status: "ok", result: res });
          recordHistory({
            sql,
            ok: true,
            rowCount: res.rowCount,
            durationMs: res.durationMs,
            error: null,
          });
          if (kind === "write") {
            toast.success(
              `Statement ran. ${res.rowCount} row${res.rowCount === 1 ? "" : "s"} affected`,
            );
            onWriteSuccess();
          }
        },
        onError: (err) => {
          const message = errMessage(err);
          settle(id, { status: "error", error: message });
          recordHistory({ sql, ok: false, rowCount: null, durationMs: null, error: message });
        },
      },
    );
  };

  const startRead = (sql: string) => start(sql, "read");
  const startWrite = (sql: string) => start(sql, "write");

  return {
    run,
    startRead,
    startWrite,
    /** A write run is in flight (disables the write toggle while executing). */
    writeRunning: run?.kind === "write" && run.status === "running",
  };
}

/**
 * Write mode → stage the EXACT statement text behind a styled confirm dialog
 * (typed-phrase gate when the statement is destructive). The dialog previews
 * `pendingWrite.sql` and `confirmPendingWrite` runs that same staged string,
 * never re-reading the editor, so the preview can never diverge from what
 * actually executes.
 */
export function useWriteConfirm({ runWrite }: { runWrite: (sql: string) => void }) {
  // Write-mode statement awaiting confirmation. Destructive statements
  // (DROP/TRUNCATE/unscoped DELETE/UPDATE) get a type-the-db-name gate in the
  // dialog; other writes a plain styled confirm. See ./data/destructive-sql.
  const [pendingWrite, setPendingWrite] = useState<{
    sql: string;
    severity: WriteSeverity;
  } | null>(null);

  const stageWrite = (sql: string) => setPendingWrite({ sql, severity: classifyWriteSql(sql) });
  const cancelPendingWrite = () => setPendingWrite(null);
  const confirmPendingWrite = () => {
    if (!pendingWrite) return;
    const sql = pendingWrite.sql;
    setPendingWrite(null);
    runWrite(sql);
  };

  return { pendingWrite, stageWrite, cancelPendingWrite, confirmPendingWrite };
}
