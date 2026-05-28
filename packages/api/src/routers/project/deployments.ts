/**
 * Deployment lifecycle — one row per logical "push" of a resource to swarm.
 *
 * Hooked from the resource lifecycle:
 *   - postgres.create        → reason="create"
 *   - setExtraEnv → redeploy → reason="env-change"
 *
 * The id is also stamped onto the swarm spec as
 *   Spec.Labels["otterdeploy.deployment.id"]
 * AND
 *   Spec.TaskTemplate.ContainerSpec.Labels["otterdeploy.deployment.id"]
 * so every task swarm schedules under this deployment carries the link back.
 * That's how `listDeploymentTasks` groups task history into deployments.
 *
 * Status starts at "pending"/"building" and is derived live from the
 * underlying tasks when the UI reads the list (no background updater
 * required — see `listResourceDeployments`).
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { desc, eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { getProjectInOrg, getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { buildContainerName } from "./views";

type OrgId = OrganizationId;

export interface DeploymentRow {
  id: DeploymentId;
  resourceId: ResourceId;
  image: string;
  reason: "create" | "redeploy" | "env-change" | "image-change" | "restart";
  status:
    | "pending"
    | "building"
    | "running"
    | "failed"
    | "superseded"
    | "removed";
  /** Full resource config at the moment of this deploy. Used by rollback to
   *  reproduce the prior state — service env, ports, command, healthcheck,
   *  database extraEnv + publicEnabled, etc. Shape is kind-specific and
   *  validated at the rollback site, not here. */
  snapshot: Record<string, unknown>;
  errorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InsertInput {
  resourceId: ResourceId;
  image: string;
  reason: DeploymentRow["reason"];
  /** Snapshot the deployment is built from. Pass the resource's full
   *  current config so rollback can reapply it verbatim later. */
  snapshot: Record<string, unknown>;
}

export async function insertDeployment(input: InsertInput): Promise<DeploymentRow> {
  const [row] = await db
    .insert(deployment)
    .values({
      resourceId: input.resourceId,
      image: input.image,
      reason: input.reason,
      status: "building",
      snapshot: input.snapshot,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to insert deployment row");
  }
  return row as DeploymentRow;
}

/** Look up a single deployment by id, scoped to a resource. Returns null
 *  when the id doesn't exist or belongs to a different resource — the
 *  rollback path uses this to refuse cross-resource snapshot loads. */
export async function getDeploymentForResource(
  resourceId: ResourceId,
  deploymentId: DeploymentId,
): Promise<DeploymentRow | null> {
  const [row] = await db
    .select()
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  if (!row) return null;
  if (row.resourceId !== resourceId) return null;
  return row as DeploymentRow;
}

/** Mark an existing deployment terminal (failed) — used when provisioning
 *  throws before swarm can take over the lifecycle. Most state transitions
 *  happen lazily via task observation in the list endpoint instead. */
export async function markDeploymentFailed(
  deploymentId: DeploymentId,
  errorMessage: string,
): Promise<void> {
  await db
    .update(deployment)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(deployment.id, deploymentId));
}

/** Drop a deployment row. Used by the recovery path in
 *  `ensureSwarmRuntimeForRecord` when the would-be `restart` deployment
 *  turned out to be a no-op (the swarm service was already there by the
 *  time provisioning ran). Leaving the row would leave the UI's
 *  Deployments tab stuck on a 0-task `building` entry forever, because
 *  no task ever inherits its deployment.id label. */
export async function deleteDeploymentById(
  deploymentId: DeploymentId,
): Promise<void> {
  await db.delete(deployment).where(eq(deployment.id, deploymentId));
}

/** All deployments for a resource, newest first. Status is the value
 *  stored in the row — the API layer can post-process / merge with live
 *  task state if needed. */
export async function listDeploymentsByResource(
  resourceId: ResourceId,
): Promise<DeploymentRow[]> {
  const rows = await db
    .select()
    .from(deployment)
    .where(eq(deployment.resourceId, resourceId))
    .orderBy(desc(deployment.createdAt));
  return rows as DeploymentRow[];
}

// ─── API-layer endpoints ────────────────────────────────────────────────

export interface DeploymentWithStats {
  id: DeploymentId;
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
    if (
      (stored === "building" || stored === "pending") &&
      ageMs > ZERO_TASK_STALE_MS
    ) {
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

interface ListInput {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
}

export async function listResourceDeployments(
  input: ListInput,
): Promise<
  Result<
    DeploymentWithStats[],
    ProjectNotFoundError | PostgresResourceNotFoundError
  >
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const rows = await listDeploymentsByResource(input.resourceId);
  if (rows.length === 0) return Result.ok([]);

  // Pull task counts per deployment from docker in a single call. The label
  // on each task lets us bucket without a per-deployment docker request.
  let serviceName: string;
  if (found.kind === "database") {
    const proj = await getProjectRecord(input.projectId);
    const slug = proj?.slug ?? input.projectId;
    serviceName = buildContainerName({
      engine: found.record.database.engine,
      projectSlug: slug,
      resourceName: found.record.resource.name,
    });
  } else {
    serviceName = found.record.service.serviceName;
  }

  const docker = Docker.fromEnv();
  const tasksByDeployment = new Map<string, string[]>();
  try {
    const tasksResult = await docker.tasks.list({
      filters: { service: [serviceName] },
    });
    if (tasksResult.isOk()) {
      for (const task of tasksResult.value) {
        const labels =
          (
            task as {
              Spec?: { ContainerSpec?: { Labels?: Record<string, string> } };
            }
          ).Spec?.ContainerSpec?.Labels ?? {};
        const deploymentId = labels["otterdeploy.deployment.id"];
        if (!deploymentId) continue;
        const state =
          (task as { Status?: { State?: string } }).Status?.State ?? "unknown";
        const bucket = tasksByDeployment.get(deploymentId) ?? [];
        bucket.push(state);
        tasksByDeployment.set(deploymentId, bucket);
      }
    }
  } finally {
    docker.destroy();
  }

  const latestId = rows[0]?.id;
  return Result.ok(
    rows.map((row) => {
      const states = tasksByDeployment.get(row.id) ?? [];
      const status = deriveDeploymentStatus(
        row.status,
        row.id === latestId,
        states,
        row.createdAt,
      );
      const failed = states.filter(
        (s) =>
          s === "failed" || s === "rejected" || s === "orphaned" || s === "remove",
      ).length;
      const running = states.filter((s) => s === "running").length;
      return {
        id: row.id,
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
    }),
  );
}

export class DeploymentNotFoundError extends Error {
  readonly _tag = "DeploymentNotFoundError" as const;
  constructor(public deploymentId: DeploymentId) {
    super(`deployment ${deploymentId} not found for this resource`);
  }
}

export class UnsupportedSnapshotError extends Error {
  readonly _tag = "UnsupportedSnapshotError" as const;
  constructor(public reason: string) {
    super(`cannot replay snapshot: ${reason}`);
  }
}

interface TasksByDeploymentInput extends ListInput {
  deploymentId: string;
}

export interface DeploymentTaskInfo {
  id: string;
  slot: number | null;
  label: string;
  state: "running" | "building" | "error";
  rawState: string | null;
  desiredState: string | null;
  nodeId: string | null;
  message: string | null;
  error: string | null;
  containerId: string | null;
  exitCode: number | null;
  timestamp: string | null;
}

function collapseTaskState(state: string | undefined): DeploymentTaskInfo["state"] {
  switch (state) {
    case "running":
      return "running";
    case "new":
    case "allocated":
    case "pending":
    case "assigned":
    case "accepted":
    case "preparing":
    case "ready":
    case "starting":
      return "building";
    case "failed":
    case "rejected":
    case "remove":
    case "orphaned":
    case "complete":
    case "shutdown":
      return "error";
    default:
      return "building";
  }
}

export async function listTasksForDeployment(
  input: TasksByDeploymentInput,
): Promise<
  Result<
    DeploymentTaskInfo[],
    ProjectNotFoundError | PostgresResourceNotFoundError
  >
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  let serviceName: string;
  if (found.kind === "database") {
    const proj = await getProjectRecord(input.projectId);
    const slug = proj?.slug ?? input.projectId;
    serviceName = buildContainerName({
      engine: found.record.database.engine,
      projectSlug: slug,
      resourceName: found.record.resource.name,
    });
  } else {
    serviceName = found.record.service.serviceName;
  }

  const docker = Docker.fromEnv();
  const tasksResult = await docker.tasks.list({
    filters: { service: [serviceName] },
  });
  if (tasksResult.isErr()) return Result.ok([]);

  const filtered = tasksResult.value.filter((task) => {
    const labels =
      (
        task as {
          Spec?: { ContainerSpec?: { Labels?: Record<string, string> } };
        }
      ).Spec?.ContainerSpec?.Labels ?? {};
    return labels["otterdeploy.deployment.id"] === input.deploymentId;
  });

  const sorted = [...filtered].sort((a, b) => {
    const at = new Date(
      (a as { UpdatedAt?: string; CreatedAt?: string }).UpdatedAt ??
        (a as { CreatedAt?: string }).CreatedAt ??
        0,
    ).getTime();
    const bt = new Date(
      (b as { UpdatedAt?: string; CreatedAt?: string }).UpdatedAt ??
        (b as { CreatedAt?: string }).CreatedAt ??
        0,
    ).getTime();
    return bt - at;
  });

  return Result.ok(
    sorted.map((t) => {
      const status =
        (t as {
          Status?: {
            State?: string;
            Message?: string;
            Err?: string;
            Timestamp?: string;
            ContainerStatus?: { ContainerID?: string; ExitCode?: number };
          };
        }).Status ?? {};
      const slot = (t as { Slot?: number }).Slot ?? null;
      const nodeId = (t as { NodeID?: string }).NodeID ?? null;
      const desiredState =
        (t as { DesiredState?: string }).DesiredState ?? null;
      return {
        id: (t as { ID?: string }).ID ?? "",
        slot,
        label: slot != null ? `${serviceName}.${slot}` : serviceName,
        state: collapseTaskState(status.State),
        rawState: status.State ?? null,
        desiredState,
        nodeId,
        message: status.Message ?? null,
        error: status.Err ?? null,
        containerId: status.ContainerStatus?.ContainerID ?? null,
        exitCode:
          typeof status.ContainerStatus?.ExitCode === "number"
            ? status.ContainerStatus.ExitCode
            : null,
        timestamp: status.Timestamp ?? null,
      };
    }),
  );
}
