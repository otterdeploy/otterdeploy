/**
 * Every Postgres statement a build helper awaits is bounded.
 *
 * The helper is a one-shot process: when its event loop drains it exits, and
 * `build-one.ts` makes that exit 1 so a build that never finished is not
 * mistaken for a success. A statement that never settles (a dropped promise in
 * the SQL or cache client, a connection whose peer went silent) holds no timer
 * and no socket the loop counts, so the loop drained mid-pipeline and the
 * helper died "without reporting a failure": the deployment was marked failed
 * by the worker with nothing but the helper's last log line as the reason.
 *
 * Inside this scope such a statement rejects with `QueryDeadlineError` after
 * the deadline instead. Its pending timer keeps the loop alive meanwhile, and
 * the pipeline step that awaited it fails through the normal path, which marks
 * the deployment failed with a reason that names Postgres. Generous on
 * purpose: a pipeline statement answers in milliseconds, and the deadline only
 * has to be shorter than forever.
 */
import { runWithQueryDeadline } from "@otterdeploy/db/query-deadline";

export const BUILD_STATEMENT_TIMEOUT_MS = 60_000;

/** Run a build's pipeline with every statement it awaits bounded. */
export function inBuildScope<T>(fn: () => T, timeoutMs: number = BUILD_STATEMENT_TIMEOUT_MS): T {
  return runWithQueryDeadline(timeoutMs, fn);
}
