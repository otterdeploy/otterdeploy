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
import { TimeoutError, withTimeout } from "@otterdeploy/shared/promise";

import type { Context } from "../context";

const PROCEDURE_TIMEOUT_MS = 120_000;

export const procedureTimeout = orpc.$context<Context>().middleware(async ({ path, next }) => {
  try {
    // Promise.resolve: oRPC's next() returns a thenable MiddlewareResult,
    // not a real Promise.
    return await withTimeout(Promise.resolve(next()), PROCEDURE_TIMEOUT_MS, path.join("."));
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new ORPCError("TIMEOUT", {
        message: `${path.join(".")} did not complete within ${PROCEDURE_TIMEOUT_MS / 1000}s.`,
      });
    }
    throw error;
  }
});
