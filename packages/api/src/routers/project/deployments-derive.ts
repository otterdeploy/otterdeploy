/**
 * Pure deployment-status derivation — no db/docker imports so it unit-tests
 * without mocking. `deployments-list.ts` feeds it live instance snapshots and
 * persists/emits around the result.
 */

import type { DeploymentRow } from "./deployments";

/**
 * Status as SHOWN to the client: the stored lifecycle status plus the
 * derived-only runtime states. `crashed` (came up once, now crash-looping or
 * gave up), `starting` (image built, container coming up), and `paused`
 * (operator scaled the service to zero) are computed live and NEVER persisted —
 * the DB row stays at its lifecycle status, so they live here at the derivation
 * boundary rather than in the `deployment_status` DB enum.
 */
export type DerivedDeploymentStatus =
  | DeploymentRow["status"]
  | "crashed"
  | "starting"
  | "paused";

/** The slice of a live container/task the derivation needs. Swarm tasks carry
 *  exitCode on failed tasks; plain-docker fills exitCode/restartCount/oomKilled
 *  from container inspect (see resource-instances `withInspect`). */
export interface InstanceGlimpse {
  state: string;
  exitCode: number | null;
  restartCount: number | null;
  oomKilled: boolean | null;
}

// Swarm task lifecycle states bucketed by what they mean for a deployment.
// Reference: https://docs.docker.com/reference/cli/docker/service/ps/
export const BUILDING_STATES = new Set([
  // Swarm task states.
  "new",
  "allocated",
  "pending",
  "assigned",
  "accepted",
  "preparing",
  "ready",
  "starting",
  // Plain-docker container states (DEPLOY_RUNTIME=docker).
  "created",
  "restarting",
]);
export const FAILED_STATES = new Set([
  "failed",
  "rejected",
  "orphaned",
  "remove",
  // For a long-running service like a database, `complete` and `shutdown`
  // on the latest task aren't a normal terminal state — they mean swarm
  // rolled back (FailureAction=rollback after the new task failed health
  // or, in the start-first → stop-first transition, the old task got
  // killed by the new one's volume conflict). Treat as a deploy failure
  // so the UI doesn't sit on "BUILDING" forever.
  "complete",
  "shutdown",
  // Plain-docker: a service container that exited/died is down.
  "exited",
  "dead",
  "paused",
  "removing",
]);
// Subset of FAILED_STATES used for the per-deployment failed-task count —
// `complete`/`shutdown` are deliberately excluded here (they only flip the
// overall status, they don't count as failed tasks).
export const FAILED_TASK_COUNT_STATES = new Set([
  "failed",
  "rejected",
  "orphaned",
  "remove",
  "exited",
  "dead",
]);

// A 0-task row this old definitely isn't still spinning up — wait-ready
// gives swarm 60s before timing out, so 3 minutes is past every legitimate
// startup window. After that, "building" forever is wrong; "failed"
// at least surfaces it as broken in the UI instead of pretending it's
// in flight. Catches phantom rows from caller-vs-provisioner races
// (see deleteDeploymentById in ensureSwarmRuntimeForRecord) and any old
// dead rows left over from before that race was closed.
export const ZERO_TASK_STALE_MS = 3 * 60_000;

// A running deployment whose swarm task keeps dying and being recreated is
// crash-looping (e.g. the app exits on a bad env var). Swarm accumulates one
// failed task per restart attempt (bounded by the daemon's task-history limit
// and our RestartPolicy MaxAttempts), so this many failed tasks for a
// deployment that already reached "running" is the signal to surface it as
// `crashed` rather than a calm `running`. Below the threshold we treat a lone
// failure as a transient restart and leave it `running`.
export const CRASH_LOOP_FAILURE_THRESHOLD = 3;

// A git-source deployment legitimately has ZERO tasks for its whole image
// build — nothing is scheduled until build+push finishes — so age alone
// can't distinguish "dead" from "slow build". The build streams log lines
// the entire time it runs (BuildKit progress alone keeps this fresh), so a
// recent log line means the builder is alive and the row stays "building".
export const BUILD_LOG_QUIET_MS = 3 * 60_000;

/** Did this instance die abnormally? A non-zero exit, an OOM kill, or a
 *  non-zero docker RestartCount (proof the restart policy was bouncing it)
 *  all count. A clean exit-0 does NOT — that's an operator stop (e.g. a
 *  stopped database), not a crash. Unknown exit codes stay conservative. */
function diedAbnormally(i: InstanceGlimpse): boolean {
  if (!FAILED_TASK_COUNT_STATES.has(i.state)) return false;
  if (i.oomKilled) return true;
  if (i.exitCode != null && i.exitCode !== 0) return true;
  return (i.restartCount ?? 0) > 0;
}

/**
 * Status for a non-latest (replaced) row. It keeps its real OUTCOME: `failed`
 * whenever it failed by any signal (stored failed, observed task failures, or a
 * crash loop), otherwise `superseded`. `superseded` must ONLY mean "was
 * live/in-flight when a newer deploy took over" — never a swallowed failure,
 * which would erase the one thing you want to know about an old deployment (did
 * it succeed or fail?). A failed deploy stays failed forever.
 */
function deriveReplacedStatus(
  stored: DeploymentRow["status"],
  failedCount: number,
  crashLooping: boolean,
): DerivedDeploymentStatus {
  return stored === "failed" || failedCount > 0 || crashLooping ? "failed" : "superseded";
}

/** Status for a row with NO live instances: no tasks yet, or docker GC'd them
 *  all. A non-latest row keeps its real outcome (see deriveReplacedStatus). */
function deriveZeroInstanceStatus(
  stored: DeploymentRow["status"],
  isLatest: boolean,
  createdAt: Date,
  buildActive: boolean,
): DerivedDeploymentStatus {
  if (!isLatest) return deriveReplacedStatus(stored, 0, false);
  // Latest row sitting at building/pending with nothing scheduled past
  // the wait-ready window AND no recent build output is a dead
  // deployment — surface it as failed instead of pinning on BUILDING.
  const ageMs = Date.now() - createdAt.getTime();
  if ((stored === "building" || stored === "pending") && ageMs > ZERO_TASK_STALE_MS) {
    return buildActive ? stored : "failed";
  }
  return stored;
}

export function deriveDeploymentStatus(
  stored: DeploymentRow["status"],
  isLatest: boolean,
  instances: InstanceGlimpse[],
  createdAt: Date,
  buildActive: boolean,
  paused: boolean,
): DerivedDeploymentStatus {
  // A paused service is scaled to zero on purpose. That overrides the runtime
  // status of its current deployment — otherwise the last-known "running"
  // sticks (0 tasks derives back to the stored status) and the card shows a
  // green RUNNING badge over a service the operator explicitly stopped. Mirrors
  // the service panel, where `pausedReplicas` overrides the runtime status.
  // Only the latest row is "paused"; historical rows keep their real outcome.
  if (isLatest && paused) return "paused";
  if (instances.length === 0) {
    return deriveZeroInstanceStatus(stored, isLatest, createdAt, buildActive);
  }
  const taskStates = instances.map((i) => i.state);
  const hasRunning = taskStates.some((s) => s === "running");
  const hasBuilding = taskStates.some((s) => BUILDING_STATES.has(s));
  const failedCount = taskStates.reduce((n, s) => (FAILED_STATES.has(s) ? n + 1 : n), 0);
  // Crash-loop signal, unified across runtimes. Swarm schedules a fresh (failed)
  // task per restart attempt, so repeated failures pile up (failedCount). Plain
  // docker (`DEPLOY_RUNTIME=docker`) restarts ONE container in place, which the
  // daemon reports as `restarting` — a single such instance already means the
  // RestartPolicy is actively bouncing a crashing container.
  const restartingNow = taskStates.some((s) => s === "restarting");
  const crashLooping = failedCount >= CRASH_LOOP_FAILURE_THRESHOLD || restartingNow;
  if (hasRunning) {
    // Up right now — but if it's also racked up repeated failures it keeps
    // coming up and dying (crash loop, e.g. a bad env var). Surface that
    // instead of a calm "running".
    return crashLooping ? "crashed" : "running";
  }
  // Nothing running this instant. A deployment that already reached "running"
  // has finished building — a task now back in a pre-running phase
  // (`starting`/`restarting`/…) is a container RESTART, not a build, so it must
  // never rewind the lifecycle status to "building" (running → building is an
  // impossible transition). Repeated failures mean it's crash-looping; a lone
  // failure is a transient restart, so it stays "running".
  if (stored === "running") {
    if (crashLooping) return "crashed";
    // Nothing running, nothing coming up, and the container died abnormally:
    // the restart policy gave up (plain docker leaves ONE exited container
    // after the on-failure cap; swarm can GC history down to a single failed
    // task). That will never self-heal — it's `crashed`, not a calm "running".
    // A clean exit-0 with no restarts (operator stop) keeps the old behavior.
    if (!hasBuilding && instances.some(diedAbnormally)) return "crashed";
    return "running";
  }
  // A stored-terminal `failed` row never rewinds to a startup phase. The one
  // way live tasks still move under it: the pipeline gave up (marked failed)
  // while docker's restart policy is still bouncing the container — that's a
  // crash loop, not a fresh start.
  if (stored === "failed" && isLatest) return crashLooping ? "crashed" : "failed";
  // Still actively bringing a task up — only show "building" while at
  // least one task is in a pre-running phase (build-phase rows only).
  if (hasBuilding) return "starting";
  // Non-latest: keep the real outcome (failed stays failed after replacement).
  if (!isLatest) return deriveReplacedStatus(stored, failedCount, crashLooping);
  if (failedCount > 0) return "failed";
  // Fallthrough: tasks exist but in unknown state. Honour the DB row.
  return stored;
}
