/**
 * Global per-procedure deadline: the backstop od-664 was missing.
 *
 * The projects page hung for three days because one handler awaited an
 * in-process promise that never settled: no query reached Postgres, no error
 * was thrown, and the request log (written on completion) never saw the
 * request. Nothing at any layer bounded the wait, so the UI showed a skeleton
 * forever while /health stayed green.
 *
 * This middleware races every procedure against a deadline and converts
 * "forever" into a typed TIMEOUT error the client can render and retry.
 *
 * Streaming procedures (events.orgStream, logs.tail, …) are safe under the
 * same deadline: their handlers RESOLVE quickly with an async iterator: the
 * deadline covers obtaining the iterator, not the lifetime of the stream.
 *
 * The limit is deliberately generous. It exists to catch never-settling
 * awaits, not to police slow-but-honest work (source uploads, database
 * snapshots); those finish well inside it or already enqueue background jobs.
 */

import { ORPCError, os as orpc } from "@orpc/server";
import {
  QueryDeadlineError,
  REQUEST_QUERY_TIMEOUT_MS,
  runWithQueryDeadline,
} from "@otterdeploy/db/query-deadline";
import { TimeoutError, withTimeout } from "@otterdeploy/shared/promise";

import type { Context } from "../context";

import { isPostgresUnreachable } from "../lib/pg-error";

const PROCEDURE_TIMEOUT_MS = 120_000;

/** Drizzle wraps a failed statement's error (`Failed query: …`, the original
 *  as `cause`), and handlers may wrap it again: look down the cause chain. */
function causedByQueryDeadline(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (QueryDeadlineError.is(current)) return true;
    current = current.cause;
  }
  return false;
}

/** The database did not answer: a statement outran the per-request query
 *  deadline, or its connection was refused, closed, or timed out. */
function isDatabaseUnavailable(error: unknown): boolean {
  return causedByQueryDeadline(error) || isPostgresUnreachable(error);
}

export const procedureTimeout = orpc.$context<Context>().middleware(async ({ path, next }) => {
  try {
    // Promise.resolve: oRPC's next() returns a thenable MiddlewareResult,
    // not a real Promise. Every Postgres statement the procedure awaits is
    // bounded by the per-request query deadline, whatever the
    // transport; the server opens the same scope around the session lookup.
    return await withTimeout(
      Promise.resolve(runWithQueryDeadline(REQUEST_QUERY_TIMEOUT_MS, () => next())),
      PROCEDURE_TIMEOUT_MS,
      path.join("."),
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new ORPCError("TIMEOUT", {
        message: `${path.join(".")} did not complete within ${PROCEDURE_TIMEOUT_MS / 1000}s.`,
      });
    }
    // A statement the request awaited outran the per-request query deadline
    // (packages/db query-deadline.ts), or its connection was refused, closed
    // or timed out (a stopped Postgres; the stalled connections a lifted
    // blackhole closes): the database is not answering, which the caller can
    // retry, not an internal failure.
    if (isDatabaseUnavailable(error)) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: "The database is not answering." });
    }
    throw error;
  }
});
