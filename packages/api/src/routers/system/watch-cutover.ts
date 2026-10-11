/**
 * The update watchdog: poll the detached updater helper to its exit and record
 * the outcome the old server would otherwise never write.
 *
 * Split from apply.ts (which owns the update's control flow) so the watchdog
 * can be driven on its own against a fake daemon.
 *
 * Every Docker call here is bounded twice: by the request client the caller
 * hands in (an idle-socket timeout per request) and by `withTimeout` capped at
 * whatever is left of the overall deadline. The second bound is the one that
 * matters: before it, the deadline was only checked BETWEEN polls, so a single
 * inspect the daemon accepted and never answered held the watchdog forever.
 * The run stayed "running" and every later apply answered "already-running",
 * the exact wedge the watchdog exists to prevent.
 */
import type { Docker } from "@otterdeploy/docker";

import { sleep, withTimeout } from "@otterdeploy/shared/promise";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";

import { currentVersion } from "./check";
import { isNewer } from "./compare";
import { readHelperLogs, relayHelperProgress } from "./helper-logs";
import * as state from "./state";

export interface WatchCutoverOptions {
  /** Gap between polls of the helper. */
  pollMs: number;
  /** Hard backstop for the whole cutover, enforced even mid-call. */
  deadlineMs: number;
  /** Ceiling for any single Docker call. */
  callTimeoutMs: number;
}

/** How often the watchdog inspects the helper, and the hard backstop after which
 *  a cutover that never reported back is declared failed so the UI un-wedges.
 *  The helper's own `up -d --wait --wait-timeout 120` plus image-pull time fits
 *  comfortably inside this; the deadline only bites if the helper vanishes or
 *  hangs. */
export const WATCH_POLL_MS = 3_000;
export const WATCH_DEADLINE_MS = 15 * 60 * 1_000;
/** One inspect / log read / remove: milliseconds on a healthy daemon. */
export const WATCH_CALL_TIMEOUT_MS = 30_000;

const nowMs = (): number => Temporal.Now.instant().epochMilliseconds;

export const WATCH_DEFAULTS: WatchCutoverOptions = {
  pollMs: WATCH_POLL_MS,
  deadlineMs: WATCH_DEADLINE_MS,
  callTimeoutMs: WATCH_CALL_TIMEOUT_MS,
};

/** Poll the detached helper to its exit; record the terminal outcome. A no-op
 *  on the happy path: this process is gone before the loop notices success.
 *  Always settles the run before returning, whatever the daemon does. Owns and
 *  destroys `docker`. */
export async function watchCutover(
  docker: Docker,
  helperId: string,
  target: string,
  opts: WatchCutoverOptions = WATCH_DEFAULTS,
): Promise<void> {
  const container = docker.containers.getContainer(helperId);
  const deadlineAt = nowMs() + opts.deadlineMs;
  /** A Docker call that answers within the call ceiling AND the time left, or
   *  null. Never throws, never outlives the deadline. */
  const call = async <T>(work: () => Promise<T>): Promise<T | null> => {
    const left = Math.min(opts.callTimeoutMs, deadlineAt - nowMs());
    if (left <= 0) return null;
    const res = await Result.tryPromise({
      try: () => withTimeout(work(), left, "update watchdog docker call"),
      catch: (cause) => cause,
    });
    return res.isOk() ? res.value : null;
  };
  try {
    // Lines of helper output already relayed, so each poll emits only what is
    // new: the helper's pull / migrate / recreate output is the only window
    // onto the slowest minutes of the update.
    let relayed = 0;
    while (nowMs() < deadlineAt) {
      await sleep(Math.max(0, Math.min(opts.pollMs, deadlineAt - nowMs())));
      const inspected = await call(() => container.inspect());
      // Unanswered, or a transient socket blip: let the deadline decide.
      if (!inspected || inspected.isErr()) continue;
      const st = inspected.value.State;
      relayed = (await call(() => relayHelperProgress(container, relayed))) ?? relayed;
      if (st?.Running !== false) continue; // still pulling / recreating
      const logs = (await call(() => readHelperLogs(container))) ?? "";
      settleExited(target, st?.ExitCode ?? 0, logs);
      await call(() => container.remove({ force: true }));
      return;
    }
    const msg = `Update to ${target} did not complete within ${Math.round(opts.deadlineMs / 60_000)} minutes. The control plane is still running the previous version. Inspect the update helper container for details.`;
    state.emit("done", msg, "error");
    state.finish(false, msg);
    // The deadline is spent, so this removal gets one call-ceiling of its own:
    // best-effort, and the run is already settled.
    await Result.tryPromise({
      try: () => withTimeout(container.remove({ force: true }), opts.callTimeoutMs),
      catch: (cause) => cause,
    });
  } finally {
    docker.destroy();
  }
}

/** The helper exited. If it succeeded AND we somehow booted the target, it's
 *  done; otherwise the cutover did not replace us, a failure. */
function settleExited(target: string, exitCode: number, logs: string): void {
  const reachedTarget = currentVersion() === target || isNewer(currentVersion(), target);
  if (exitCode === 0 && reachedTarget) {
    state.emit(
      "done",
      `Update to ${target} complete. Control plane is running ${currentVersion()}.`,
      "success",
    );
    state.finish(true);
    return;
  }
  const why =
    exitCode === 0
      ? `finished but the control plane is still on ${currentVersion()} (expected ${target})`
      : `failed (exit ${exitCode})`;
  const msg = `Update helper ${why}. The control plane was not replaced and is still running the previous version.${logs ? `\n${logs}` : ""}`;
  state.emit("done", msg, "error");
  state.finish(false, msg);
}
