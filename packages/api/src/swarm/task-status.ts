/**
 * Pure task-state mapping for the swarm driver: how a service's live tasks
 * resolve to a runtime status + failure reason. Split out of internals.ts
 * (line cap); consumed by its service inspection and the status tests.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";

import type { SwarmServiceRuntime } from "./service";

/** Terminal task states that mean the attempt hard-failed (as opposed to still
 *  converging). A failed task records its reason in `Status.Err`. */
const FAILED_TASK_STATES = new Set(["failed", "rejected", "orphaned"]);

/** Minimal shape of a swarm task we reason over. `Status.Err` isn't declared on
 *  the client's task type, but the engine always populates it on a failed task. */
export interface TaskLike {
  CreatedAt?: string | null;
  Status?: { State?: string; Err?: string; Timestamp?: string };
  Spec?: { ContainerSpec?: { Image?: string } };
}

/**
 * How long a task may sit in `preparing` (its node pulling the image) before
 * the status says so. A node that cannot reach the image's registry (dropped
 * packets, not refused ones) keeps the pull hanging with no error for many
 * minutes, and the service read a silent "starting" the whole time. Long
 * enough for an ordinary large pull to finish first.
 */
export const IMAGE_PULL_STALL_MS = 3 * 60_000;

/** Milliseconds `task` has been in its current state, or null if unknown. */
function stateAgeMs(task: TaskLike, nowMs: number): number | null {
  const since = task.Status?.Timestamp ?? task.CreatedAt;
  if (!since) return null;
  const parsed = Result.try(() => Temporal.Instant.from(since).epochMilliseconds);
  return parsed.isOk() ? nowMs - parsed.value : null;
}

/** The reason a task stuck pulling its image is reported with. */
function pullStallMessage(task: TaskLike, ageMs: number): string {
  const image = task.Spec?.ContainerSpec?.Image?.split("@")[0] ?? "its image";
  const minutes = Math.floor(ageMs / 60_000);
  return `image ${image} has not finished pulling after ${minutes} min on its node: check that the node can reach the image's registry`;
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
export function resolveTaskStatus(
  tasks: TaskLike[],
  nowMs: number = Temporal.Now.instant().epochMilliseconds,
): {
  status: SwarmServiceRuntime["status"];
  errorMessage: string | null;
} {
  const sorted = [...tasks].sort(byCreatedDesc);
  const newest = sorted.at(0);
  const currentStatus = mapTaskStateToStatus(newest?.Status?.State);
  const recentFailure =
    currentStatus === "running"
      ? undefined
      : sorted.find((t) => FAILED_TASK_STATES.has(t.Status?.State ?? "") && taskErr(t));
  if (recentFailure) return { status: "error", errorMessage: taskErr(recentFailure) };
  // A pull that hangs fails nothing, so no task carries an Err to surface:
  // past the bound, say what is happening instead of "starting" forever.
  const pulling = newest?.Status?.State === "preparing" ? stateAgeMs(newest, nowMs) : null;
  if (newest && pulling !== null && pulling >= IMAGE_PULL_STALL_MS) {
    return { status: "error", errorMessage: pullStallMessage(newest, pulling) };
  }
  return { status: currentStatus, errorMessage: null };
}

/** The image the newest task is still pulling (it sits in `preparing`), or
 *  null: how a rollout that timed out says it never got its image. */
export function pullingImage(tasks: TaskLike[]): string | null {
  const newest = [...tasks].sort(byCreatedDesc).at(0);
  if (newest?.Status?.State !== "preparing") return null;
  return newest.Spec?.ContainerSpec?.Image?.split("@")[0] ?? "its image";
}

/** The newest hard-failed task's reason, whatever is running now: after a
 *  rollback the old task runs again, and this is why the new one did not. */
export function recentTaskFailure(tasks: TaskLike[]): string | null {
  const failed = [...tasks]
    .sort(byCreatedDesc)
    .find((t) => FAILED_TASK_STATES.has(t.Status?.State ?? "") && taskErr(t));
  return taskErr(failed);
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
