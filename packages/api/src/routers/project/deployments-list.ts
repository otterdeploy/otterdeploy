/**
 * Read-side of the deployment API. Status is derived live from the underlying
 * swarm tasks when the UI reads the list (no background updater — see
 * `listResourceDeployments`), then the building/pending → running flip is
 * persisted lazily and `deploy.succeeded` emitted exactly once.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { DeploymentRow } from "./deployments";

import { emitDeploySucceeded } from "./deployments-emit";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { getProjectInOrg, getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { buildContainerName } from "./views";

type OrgId = OrganizationId;
type ResolvedResource = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;

export interface DeploymentWithStats {
  id: DeploymentId;
  projectId: ProjectId;
  resourceId: ResourceId;
  image: string;
  reason: DeploymentRow["reason"];
  /** Final status derived from underlying tasks. Falls back to the row's
   *  stored status when no tasks exist (e.g. pending creation). */
  status: DeploymentRow["status"];
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Swarm task lifecycle states bucketed by what they mean for a deployment.
// Reference: https://docs.docker.com/reference/cli/docker/service/ps/
const BUILDING_STATES = new Set([
  "new",
  "allocated",
  "pending",
  "assigned",
  "accepted",
  "preparing",
  "ready",
  "starting",
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
]);
// Subset of FAILED_STATES used for the per-deployment failed-task count —
// `complete`/`shutdown` are deliberately excluded here (they only flip the
// overall status, they don't count as failed tasks).
const FAILED_TASK_COUNT_STATES = new Set(["failed", "rejected", "orphaned", "remove"]);

// A 0-task row this old definitely isn't still spinning up — wait-ready
// gives swarm 60s before timing out, so 3 minutes is past every legitimate
// startup window. After that, "building" forever is wrong; "failed"
// at least surfaces it as broken in the UI instead of pretending it's
// in flight. Catches phantom rows from caller-vs-provisioner races
// (see deleteDeploymentById in ensureSwarmRuntimeForRecord) and any old
// dead rows left over from before that race was closed.
const ZERO_TASK_STALE_MS = 3 * 60_000;

function deriveDeploymentStatus(
  stored: DeploymentRow["status"],
  isLatest: boolean,
  taskStates: string[],
  createdAt: Date,
): DeploymentRow["status"] {
  if (taskStates.length === 0) {
    // No tasks yet OR docker GC'd them all (very old deployments). Only
    // mark "superseded" when this isn't the most recent — otherwise we'd
    // lose info on a fresh deploy that hasn't scheduled tasks yet.
    if (!isLatest) return "superseded";
    // Latest row sitting at building/pending with nothing scheduled past
    // the wait-ready window is a dead deployment — surface it as failed
    // instead of letting the UI pin on BUILDING.
    const ageMs = Date.now() - createdAt.getTime();
    if ((stored === "building" || stored === "pending") && ageMs > ZERO_TASK_STALE_MS) {
      return "failed";
    }
    return stored;
  }
  const hasRunning = taskStates.some((s) => s === "running");
  const hasBuilding = taskStates.some((s) => BUILDING_STATES.has(s));
  const hasFailing = taskStates.some((s) => FAILED_STATES.has(s));
  if (hasRunning) return "running";
  // Still actively bringing a task up — only show "building" while at
  // least one task is in a pre-running phase.
  if (hasBuilding) return "building";
  if (!isLatest) return "superseded";
  if (hasFailing) return "failed";
  // Fallthrough: tasks exist but in unknown state. Honour the DB row.
  return stored;
}

/** All deployments for a resource, newest first. Status is the value
 *  stored in the row — derived live by `listResourceDeployments`. */
async function listDeploymentsByResource(resourceId: ResourceId): Promise<DeploymentRow[]> {
  const rows = await db
    .select()
    .from(deployment)
    .where(eq(deployment.resourceId, resourceId))
    .orderBy(desc(deployment.createdAt));
  return rows as DeploymentRow[];
}

/**
 * Persist the building/pending → running flip for deployments whose tasks have
 * come up, and emit `deploy.succeeded` exactly once per deployment. The
 * conditional UPDATE (status still building/pending) is the concurrency guard:
 * only the caller whose update actually changes a row emits, so concurrent
 * list requests can't double-fire. This is the "success detector" — there is
 * no background updater; status is reconciled lazily when the list is read.
 */
async function reconcileDeploySuccess(
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
      await emitDeploySucceeded({ deploymentId: id, resourceId });
    }
  }
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

// One docker call covers every task for the service. Bucket the task states by
// the `otterdeploy.deployment.id` label so we never need a per-deployment call.
async function loadTaskStatesByDeployment(serviceName: string): Promise<Map<string, string[]>> {
  const docker = Docker.fromEnv();
  const tasksByDeployment = new Map<string, string[]>();
  try {
    const tasksResult = await docker.tasks.list({ filters: { service: [serviceName] } });
    if (tasksResult.isErr()) return tasksByDeployment;
    for (const task of tasksResult.value) {
      const labels =
        (task as { Spec?: { ContainerSpec?: { Labels?: Record<string, string> } } }).Spec
          ?.ContainerSpec?.Labels ?? {};
      const deploymentId = labels["otterdeploy.deployment.id"];
      if (!deploymentId) continue;
      const state = (task as { Status?: { State?: string } }).Status?.State ?? "unknown";
      const bucket = tasksByDeployment.get(deploymentId) ?? [];
      bucket.push(state);
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
): DeploymentWithStats {
  const status = deriveDeploymentStatus(row.status, isLatest, states, row.createdAt);
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
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface ListInput {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
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

  const rows = await listDeploymentsByResource(input.resourceId);
  if (rows.length === 0) return Result.ok([]);

  const serviceName = await resolveDeploymentServiceName(found, input.projectId);
  const tasksByDeployment = await loadTaskStatesByDeployment(serviceName);

  const latestId = rows[0]?.id;
  const justSucceeded: DeploymentId[] = [];
  const result = rows.map((row) => {
    const states = tasksByDeployment.get(row.id) ?? [];
    const stats = toDeploymentWithStats(row, input.projectId, row.id === latestId, states);
    // A row stored building/pending whose tasks are now running has just
    // succeeded — flag it for the reconcile + emit below.
    if (stats.status === "running" && (row.status === "building" || row.status === "pending")) {
      justSucceeded.push(row.id);
    }
    return stats;
  });

  if (justSucceeded.length > 0) {
    await reconcileDeploySuccess(justSucceeded, input.resourceId);
  }
  return Result.ok(result);
}
