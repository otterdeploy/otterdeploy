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
 * Both paths are now the SAME procedure, `data.run`, differing only by its
 * `write` flag — which selects a read-only or read-write SESSION on the server.
 * The previous split (`database.query` vs `database.execute`) put the read-only
 * guarantee in the choice of endpoint; it now lives in a connect-time server
 * setting, so a statement cannot write just because it reached the wrong one.
 *
 * The confirm dialog stages the exact statement text; the confirmed run executes
 * that same staged string and lands in the same run slot, so write results and
 * errors render in the results pane rather than only as toasts.
 */

import type { Grid } from "@otterdeploy/data-engine";

import { useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

import type { QueryHistoryEntry } from "./data/query-history";
import type { WorkbenchTarget } from "./data/target";

import { classifyWriteSql, type WriteSeverity } from "./data/destructive-sql";
import { SQL_RESULT_CAP } from "./data/queries";

type RecordHistory = (e: Omit<QueryHistoryEntry, "id" | "at">) => void;

/** Pull the human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to the message. */
export function errMessage(error: unknown): string {
  // A console run stores the reason it already extracted (`SqlRunState.error`),
  // so the results pane hands a string back here; return it as is.
  if (typeof error === "string" && error.length > 0) return error;
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

/** The typed grid `data.run` returns. */
export type SqlRunResult = Grid;

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
 * Owns the console's run lifecycle. `startRead` runs against a read-only
 * session; `startWrite` against a read-write one. Both are `data.run`, both are
 * audited, and both record a history entry exactly once in their settle callback.
 */
export function useSqlRuns({
  target,
  recordHistory,
  onWriteSuccess,
}: {
  target: WorkbenchTarget;
  recordHistory: RecordHistory;
  onWriteSuccess: () => void;
}) {
  const [run, setRun] = useState<SqlRunState | null>(null);
  const runSeq = useRef(0);

  // One procedure for both paths. `write` picks the session mode server-side.
  const runMutation = useMutation(orpc.data.run.mutationOptions());

  // Settle a run's outcome. Ignored unless it's still the latest run, so a
  // slow older request can never overwrite a newer run's state.
  const settle = (id: number, patch: Partial<SqlRunState>) => {
    setRun((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  };

  const start = (sql: string, kind: "read" | "write") => {
    const id = ++runSeq.current;
    setRun({ id, sql, kind, status: "running", result: null, error: null });
    runMutation.mutate(
      { target, sql, limit: SQL_RESULT_CAP, write: kind === "write" },
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
