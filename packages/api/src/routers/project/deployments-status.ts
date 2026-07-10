/**
 * Deployment status derivation — pure mapping from swarm/plain-docker task
 * states (plus row age and build-log liveness) to the status SHOWN to the
 * client. Split out of deployments-list.ts, which keeps the DB/docker reads
 * and re-exports this module so its import seam is unchanged.
 */
import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import type { DeploymentRow } from "./deployments";

/**
 * Status as SHOWN to the client: the stored lifecycle status plus the
 * derived-only `crashing` runtime state — a container that already came up once
 * but keeps restarting/dying. `crashed` is computed live from task states and
 * is NEVER persisted (the DB row stays at its lifecycle status, usually
 * `running`), so it lives here at the derivation boundary rather than in the
 * `deployment_status` DB enum.
 */
export type DerivedDeploymentStatus = DeploymentRow["status"] | "crashed" | "starting";

export interface DeploymentWithStats {
  id: DeploymentId;
  projectId: ProjectId;
  resourceId: ResourceId;
  image: string;
  reason: DeploymentRow["reason"];
  /** Final status derived from underlying tasks. Falls back to the row's
   *  stored status when no tasks exist (e.g. pending creation). */
  status: DerivedDeploymentStatus;
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Swarm task lifecycle states bucketed by what they mean for a deployment.
// Reference: https://docs.docker.com/reference/cli/docker/service/ps/
const BUILDING_STATES = new Set([
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
const FAILED_STATES = new Set([
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
const FAILED_TASK_COUNT_STATES = new Set([
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
// `crashing` rather than a calm `running`. Below the threshold we treat a lone
// failure as a transient restart and leave it `running`.
const CRASH_LOOP_FAILURE_THRESHOLD = 3;

export function deriveDeploymentStatus(
  stored: DeploymentRow["status"],
  isLatest: boolean,
  taskStates: string[],
  createdAt: Date,
  buildActive: boolean,
): DerivedDeploymentStatus {
  if (taskStates.length === 0) {
    // No tasks yet OR docker GC'd them all (very old deployments). Only
    // mark "superseded" when this isn't the most recent — otherwise we'd
    // lose info on a fresh deploy that hasn't scheduled tasks yet.
    if (!isLatest) return "superseded";
    // Latest row sitting at building/pending with nothing scheduled past
    // the wait-ready window AND no recent build output is a dead
    // deployment — surface it as failed instead of pinning on BUILDING.
    const ageMs = Date.now() - createdAt.getTime();
    if ((stored === "building" || stored === "pending") && ageMs > ZERO_TASK_STALE_MS) {
      return buildActive ? stored : "failed";
    }
    return stored;
  }
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
  if (stored === "running") return crashLooping ? "crashed" : "running";
  // Still actively bringing a task up — only show "building" while at
  // least one task is in a pre-running phase (build-phase rows only).
  if (hasBuilding) return "starting";
  if (!isLatest) return "superseded";
  if (failedCount > 0) return "failed";
  // Fallthrough: tasks exist but in unknown state. Honour the DB row.
  return stored;
}

export function toDeploymentWithStats(
  row: DeploymentRow,
  projectId: ProjectId,
  isLatest: boolean,
  states: string[],
  buildActive: boolean,
): DeploymentWithStats {
  const status = deriveDeploymentStatus(row.status, isLatest, states, row.createdAt, buildActive);
  const failed = states.filter((s) => FAILED_TASK_COUNT_STATES.has(s)).length;
  const running = states.filter((s) => s === "running").length;
  return {
    id: row.id,
    projectId,
    resourceId: row.resourceId,
    image: row.image,
    reason: row.reason,
    status,
    errorMessage: row.errorMessage,
    taskCount: states.length,
    failedTaskCount: failed,
    runningTaskCount: running,
    gitSha: row.gitSha,
    gitRef: row.gitRef,
    gitCommitMessage: row.gitCommitMessage,
    gitCommitAuthor: row.gitCommitAuthor,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
