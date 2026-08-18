/**
 * Pure task-state mapping for the swarm driver: how a service's live tasks
 * resolve to a runtime status + failure reason. Split out of internals.ts
 * (line cap); consumed by its service inspection and the status tests.
 */

import type { SwarmServiceRuntime } from "./service";

/** Terminal task states that mean the attempt hard-failed (as opposed to still
 *  converging). A failed task records its reason in `Status.Err`. */
const FAILED_TASK_STATES = new Set(["failed", "rejected", "orphaned"]);

/** Minimal shape of a swarm task we reason over. `Status.Err` isn't declared on
 *  the client's task type, but the engine always populates it on a failed task. */
export interface TaskLike {
  CreatedAt?: string | null;
  Status?: { State?: string; Err?: string };
}

/** Newest-first comparator by CreatedAt. */
export function byCreatedDesc(a: TaskLike, b: TaskLike): number {
  return new Date(b.CreatedAt ?? 0).getTime() - new Date(a.CreatedAt ?? 0).getTime();
}

/** A swarm task's failure reason, or null. */
function taskErr(task: TaskLike | undefined): string | null {
  const err = task?.Status?.Err;
  return typeof err === "string" && err.length > 0 ? err : null;
}

/**
 * Decide a service's runtime status + failure reason from its tasks. PURE and
 * exported for testing.
 *
 * The newest task drives the live status. But swarm keeps spawning replacement
 * tasks when one can't start (its image isn't pullable, the container exits
 * immediately, …), so the newest task is frequently a fresh "preparing"/"pending"
 * retry even while every attempt fails: which `mapTaskStateToStatus` reads as
 * "starting". Unless a task is actually running, surface the most recent hard
 * failure's reason so a stuck rollout reports as "error" (and the deploy is
 * marked failed) instead of an eternal "starting" a caller mistakes for success.
 */
export function resolveTaskStatus(tasks: TaskLike[]): {
  status: SwarmServiceRuntime["status"];
  errorMessage: string | null;
} {
  const sorted = [...tasks].sort(byCreatedDesc);
  const currentStatus = mapTaskStateToStatus(sorted.at(0)?.Status?.State);
  const recentFailure =
    currentStatus === "running"
      ? undefined
      : sorted.find((t) => FAILED_TASK_STATES.has(t.Status?.State ?? "") && taskErr(t));
  return {
    status: recentFailure ? "error" : currentStatus,
    errorMessage: taskErr(recentFailure),
  };
}

function mapTaskStateToStatus(state: string | undefined): SwarmServiceRuntime["status"] {
  switch (state) {
    case "running":
      return "running";
    case "starting":
    case "preparing":
    case "assigned":
    case "accepted":
    case "ready":
    case "pending":
    case "new":
      return "starting";
    case "complete":
    case "shutdown":
      return "stopped";
    case "failed":
    case "rejected":
    case "orphaned":
    case "remove":
      return "error";
    default:
      return "missing";
  }
}

export function mapTaskHealth(
  task: { Status?: { State?: string } } | undefined,
): SwarmServiceRuntime["health"] {
  if (!task) return null;
  const state = task.Status?.State;
  if (state === "running") return "healthy";
  if (state === "starting" || state === "preparing") return "starting";
  return null;
}
