/**
 * One pass of an in-process background service (the interval sweepers and
 * schedulers in apps/server/src/background-services.ts), run so that its
 * failure can never take the control plane down.
 *
 * Bun exits the process on an unhandled rejection, and a timer callback has no
 * caller to hand a rejection to: `setInterval(() => void pass())` turns any
 * error the pass does not catch itself into a crash. A Postgres outage is
 * exactly that error. When a 45 s network blackhole to Postgres lifted, the
 * pool's stalled connections closed with ERR_POSTGRES_IDLE_TIMEOUT, the
 * node-enrollment reaper's and the backup scheduler's queries rejected, and the
 * server process exited: every in-flight API call was cut off and the API
 * refused connections until Docker restarted it.
 *
 * A failed pass is logged and the next tick runs as usual.
 */
import { Result } from "better-result";
import { log } from "evlog";

/** Run `pass` once; a rejection is logged under `task`, never rethrown. */
export function runBackgroundPass(task: string, pass: () => Promise<unknown>): void {
  void Result.tryPromise({ try: pass, catch: (cause) => cause }).then((outcome) => {
    if (outcome.isOk()) return;
    const cause = outcome.error;
    log.error({
      background: { task, status: "failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}
