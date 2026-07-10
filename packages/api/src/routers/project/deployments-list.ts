/**
 * Read-side of the deployment API. Status is derived live from the underlying
 * swarm tasks when the UI reads the list (no background updater — see
 * `listResourceDeployments`), then the building/pending → running flip is
 * persisted lazily and `deploy.succeeded` emitted exactly once.
 */
import type {
  PreviewId,
  DeploymentId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema/build";
import { deployment } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { DeploymentRow } from "./deployments";

import { loadPreviewScope } from "../../lib/environment/load";
import { runtimeServiceName } from "../../lib/environment/scoping";
import { emitDeploySucceeded } from "./deployments-emit";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { publishResourceChanged } from "./project-event-bus";
import { getProjectInOrg, getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { listResourceInstances } from "./resource-instances";
import { buildContainerName } from "./views";

type OrgId = OrganizationId;
type ResolvedResource = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;

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
const ZERO_TASK_STALE_MS = 3 * 60_000;

// A running deployment whose swarm task keeps dying and being recreated is
// crash-looping (e.g. the app exits on a bad env var). Swarm accumulates one
// failed task per restart attempt (bounded by the daemon's task-history limit
// and our RestartPolicy MaxAttempts), so this many failed tasks for a
// deployment that already reached "running" is the signal to surface it as
// `crashing` rather than a calm `running`. Below the threshold we treat a lone
// failure as a transient restart and leave it `running`.
const CRASH_LOOP_FAILURE_THRESHOLD = 3;

// A git-source deployment legitimately has ZERO tasks for its whole image
// build — nothing is scheduled until build+push finishes — so age alone
// can't distinguish "dead" from "slow build". The build streams log lines
// the entire time it runs (BuildKit progress alone keeps this fresh), so a
// recent log line means the builder is alive and the row stays "building".
const BUILD_LOG_QUIET_MS = 3 * 60_000;

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

/** All deployments for a resource, newest first. Status is the value
 *  stored in the row — derived live by `listResourceDeployments`. */
async function listDeploymentsByResource(
  resourceId: ResourceId,
  // Base rows by default; a preview id scopes to that PR's deployments (the
  // preview panel's history view).
  previewId: PreviewId | null = null,
): Promise<DeploymentRow[]> {
  const rows = await db
    .select()
    .from(deployment)
    .where(
      and(
        eq(deployment.resourceId, resourceId),
        previewId ? eq(deployment.previewId, previewId) : isNull(deployment.previewId),
      ),
    )
    .orderBy(desc(deployment.createdAt));
  return rows as DeploymentRow[];
}

/**
 * Persist the building/pending → running flip for deployments whose tasks have
 * come up, and emit `deploy.succeeded` exactly once per deployment. The
 * conditional UPDATE (status still building/pending) is the concurrency guard:
 * only the caller whose update actually changes a row emits, so concurrent
 * list requests can't double-fire. This is the "success detector" — the list
 * read reconciles lazily, and provisioning paths that already waited for the
 * container to come up call it eagerly so the Deployments card flips in the
 * same moment as the live runtime badge instead of a poll later.
 */
export async function reconcileDeploySuccess(
  deploymentIds: DeploymentId[],
  resourceId: ResourceId,
): Promise<void> {
  for (const id of deploymentIds) {
    const flipped = await db
      .update(deployment)
      .set({ status: "running", completedAt: new Date() })
      .where(and(eq(deployment.id, id), inArray(deployment.status, ["building", "pending"])))
      .returning({ id: deployment.id });
    if (flipped.length > 0) {
      void publishResourceChanged(resourceId);
      await emitDeploySucceeded({ deploymentId: id, resourceId });
    }
  }
}

/**
 * Is the latest deployment's build still producing output? Only consulted
 * when the zero-task stale window would flip it to "failed" — one indexed
 * lookup for the newest log line, skipped entirely on the happy paths.
 */
export async function isBuildStillLogging(
  latest: Pick<DeploymentRow, "id" | "status" | "createdAt"> | undefined,
  tasksByDeployment: Map<string, string[]>,
): Promise<boolean> {
  if (!latest) return false;
  if (latest.status !== "building" && latest.status !== "pending") return false;
  if ((tasksByDeployment.get(latest.id) ?? []).length > 0) return false;
  if (Date.now() - latest.createdAt.getTime() <= ZERO_TASK_STALE_MS) return false;
  const [lastLine] = await db
    .select({ ts: deploymentLog.ts })
    .from(deploymentLog)
    .where(eq(deploymentLog.deploymentId, latest.id))
    .orderBy(desc(deploymentLog.seq))
    .limit(1);
  return lastLine != null && Date.now() - lastLine.ts.getTime() < BUILD_LOG_QUIET_MS;
}

// Resolve the swarm service name backing a resource — postgres uses the
// deterministic container-name pattern; services store it on the row.
export async function resolveDeploymentServiceName(
  found: ResolvedResource,
  projectId: ProjectId,
): Promise<string> {
  if (found.kind === "database") {
    const proj = await getProjectRecord(projectId);
    const slug = proj?.slug ?? projectId;
    return buildContainerName({
      engine: found.record.database.engine,
      projectSlug: slug,
      resourceName: found.record.resource.name,
    });
  }
  return found.record.service.serviceName;
}

// One runtime-aware call covers every instance for the service (swarm tasks or
// plain-docker containers). Bucket their states by the `otterdeploy.deployment.id`
// label so we never need a per-deployment call.
export async function loadTaskStatesByDeployment(
  serviceName: string,
): Promise<Map<string, string[]>> {
  const docker = Docker.fromEnv();
  const tasksByDeployment = new Map<string, string[]>();
  try {
    const instancesResult = await listResourceInstances(docker, serviceName);
    if (instancesResult.isErr()) return tasksByDeployment;
    for (const instance of instancesResult.value) {
      const deploymentId = instance.deploymentId;
      if (!deploymentId) continue;
      const bucket = tasksByDeployment.get(deploymentId) ?? [];
      bucket.push(instance.state ?? "unknown");
      tasksByDeployment.set(deploymentId, bucket);
    }
  } finally {
    docker.destroy();
  }
  return tasksByDeployment;
}

function toDeploymentWithStats(
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

interface ListInput {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  previewId?: PreviewId | null;
}

export async function listResourceDeployments(
  input: ListInput,
): Promise<Result<DeploymentWithStats[], ProjectNotFoundError | PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const rows = await listDeploymentsByResource(input.resourceId, input.previewId ?? null);
  if (rows.length === 0) return Result.ok([]);

  let serviceName = await resolveDeploymentServiceName(found, input.projectId);
  if (input.previewId) {
    // Preview deployments run under the pr-suffixed container — derive task
    // states from THAT name or every preview row reads as zero tasks.
    const scope = await loadPreviewScope(input.previewId);
    if (scope) serviceName = runtimeServiceName(serviceName, scope);
  }
  const tasksByDeployment = await loadTaskStatesByDeployment(serviceName);

  const latestId = rows[0]?.id;
  const latestBuildActive = await isBuildStillLogging(rows[0], tasksByDeployment);
  const justSucceeded: DeploymentId[] = [];
  const result = rows.map((row) => {
    const states = tasksByDeployment.get(row.id) ?? [];
    const stats = toDeploymentWithStats(
      row,
      input.projectId,
      row.id === latestId,
      states,
      row.id === latestId && latestBuildActive,
    );
    // A row stored building/pending whose tasks are now running has just
    // succeeded — flag it for the reconcile + emit below.
    // Only reconcile+notify for BASE listings. A preview panel open would
    // otherwise drive the base-styled deploy.succeeded notification over
    // preview rows; the builder's markRunning settles preview rows itself.
    if (
      !input.previewId &&
      stats.status === "running" &&
      (row.status === "building" || row.status === "pending")
    ) {
      justSucceeded.push(row.id);
    }
    return stats;
  });

  if (justSucceeded.length > 0) {
    await reconcileDeploySuccess(justSucceeded, input.resourceId);
  }
  return Result.ok(result);
}
