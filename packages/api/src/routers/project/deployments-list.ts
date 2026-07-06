/**
 * Read-side of the deployment API. Status is derived live from the underlying
 * swarm tasks when the UI reads the list (no background updater — see
 * `listResourceDeployments`), then the building/pending → running flip is
 * persisted lazily and `deploy.succeeded` emitted exactly once.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema/build";
import { deployment } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { DeploymentRow } from "./deployments";
import type { DerivedDeploymentStatus, InstanceGlimpse } from "./deployments-derive";

import {
  BUILD_LOG_QUIET_MS,
  deriveDeploymentStatus,
  FAILED_TASK_COUNT_STATES,
  ZERO_TASK_STALE_MS,
} from "./deployments-derive";
import { emitDeploySucceeded } from "./deployments-emit";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { publishResourceChanged } from "./project-event-bus";
import { getProjectInOrg, getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { listResourceInstances } from "./resource-instances";
import { buildContainerName } from "./views";

type OrgId = OrganizationId;
type ResolvedResource = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;

export type { DerivedDeploymentStatus } from "./deployments-derive";

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
  /** Restart-policy attempts observed on the live container. Plain docker →
   *  the daemon's RestartCount; swarm → failed-task count (one task per
   *  attempt). Null when nothing has restarted. */
  restartCount: number | null;
  /** The configured restart cap (RestartPolicy MaxAttempts, incl. the
   *  platform default). Null = unlimited ("any"/"unless-stopped"). */
  restartMaxAttempts: number | null;
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

const STALE_BUILD_MESSAGE =
  "No container appeared and the build produced no output for over 3 minutes — " +
  "the build process likely died or was never picked up (is the builder running?).";

/**
 * Persist the stale zero-task building/pending → failed flip the derivation
 * decided on, and emit `deploy.failed` exactly once. Mirror of
 * `reconcileDeploySuccess`: the conditional UPDATE (status still
 * building/pending) is the concurrency guard, so concurrent list reads can't
 * double-fire, and a builder that grabs the row at the same moment wins.
 */
export async function reconcileDeployFailure(deploymentIds: DeploymentId[]): Promise<void> {
  const { markDeploymentFailed } = await import("./deployments");
  for (const id of deploymentIds) {
    const flipped = await db
      .update(deployment)
      .set({ status: "failed", errorMessage: STALE_BUILD_MESSAGE, completedAt: new Date() })
      .where(and(eq(deployment.id, id), inArray(deployment.status, ["building", "pending"])))
      .returning({ id: deployment.id });
    // markDeploymentFailed re-writes the same terminal values (harmless) and
    // owns the publish + deploy.failed notification plumbing.
    if (flipped.length > 0) await markDeploymentFailed(id, STALE_BUILD_MESSAGE);
  }
}

/**
 * Is the latest deployment's build still producing output? Only consulted
 * when the zero-task stale window would flip it to "failed" — one indexed
 * lookup for the newest log line, skipped entirely on the happy paths.
 */
async function isBuildStillLogging(
  latest: DeploymentRow | undefined,
  tasksByDeployment: Map<string, InstanceGlimpse[]>,
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
// plain-docker containers). Bucket them by the `otterdeploy.deployment.id`
// label so we never need a per-deployment call. `withInspect` fills exit code /
// restart count / OOM flag under plain docker — the derivation needs those to
// tell a crash that gave up from an operator stop.
async function loadTaskStatesByDeployment(
  serviceName: string,
): Promise<Map<string, InstanceGlimpse[]>> {
  const docker = Docker.fromEnv();
  const tasksByDeployment = new Map<string, InstanceGlimpse[]>();
  try {
    const instancesResult = await listResourceInstances(docker, serviceName, {
      withInspect: true,
    });
    if (instancesResult.isErr()) return tasksByDeployment;
    for (const instance of instancesResult.value) {
      const deploymentId = instance.deploymentId;
      if (!deploymentId) continue;
      const bucket = tasksByDeployment.get(deploymentId) ?? [];
      bucket.push({
        state: instance.state ?? "unknown",
        exitCode: instance.exitCode,
        restartCount: instance.restartCount,
        oomKilled: instance.oomKilled,
      });
      tasksByDeployment.set(deploymentId, bucket);
    }
  } finally {
    docker.destroy();
  }
  return tasksByDeployment;
}

/** The restart cap in effect for this resource, mirroring what the drivers
 *  actually apply (see toRestartPolicy / swarm internals / DB driver): services
 *  default `on-failure` to maxAttempts ?? 5; "any" is unlimited (null);
 *  databases are hard-capped at 5. */
function resolveRestartMaxAttempts(found: ResolvedResource): number | null {
  if (found.kind === "database") return 5;
  const svc = found.record.service;
  if (svc.restartCondition === "on-failure") return svc.restartMaxAttempts ?? 5;
  if (svc.restartCondition === "none") return 0;
  return null;
}

function toDeploymentWithStats(
  row: DeploymentRow,
  projectId: ProjectId,
  isLatest: boolean,
  instances: InstanceGlimpse[],
  buildActive: boolean,
  restartMaxAttempts: number | null,
): DeploymentWithStats {
  const status = deriveDeploymentStatus(
    row.status,
    isLatest,
    instances,
    row.createdAt,
    buildActive,
  );
  const failed = instances.filter((i) => FAILED_TASK_COUNT_STATES.has(i.state)).length;
  const running = instances.filter((i) => i.state === "running").length;
  // Plain docker reports the daemon's own counter; swarm schedules a fresh
  // task per attempt so the failed-task count is the attempt count.
  const dockerRestarts = Math.max(0, ...instances.map((i) => i.restartCount ?? 0));
  const restartCount = dockerRestarts > 0 ? dockerRestarts : failed > 0 ? failed : null;
  return {
    id: row.id,
    projectId,
    resourceId: row.resourceId,
    image: row.image,
    reason: row.reason,
    status,
    errorMessage: row.errorMessage,
    taskCount: instances.length,
    failedTaskCount: failed,
    runningTaskCount: running,
    gitSha: row.gitSha,
    gitRef: row.gitRef,
    gitCommitMessage: row.gitCommitMessage,
    gitCommitAuthor: row.gitCommitAuthor,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    restartCount,
    restartMaxAttempts,
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
  const latestBuildActive = await isBuildStillLogging(rows[0], tasksByDeployment);
  const restartMaxAttempts = resolveRestartMaxAttempts(found);
  const justSucceeded: DeploymentId[] = [];
  const justDied: DeploymentId[] = [];
  const result = rows.map((row) => {
    const states = tasksByDeployment.get(row.id) ?? [];
    const stats = toDeploymentWithStats(
      row,
      input.projectId,
      row.id === latestId,
      states,
      row.id === latestId && latestBuildActive,
      restartMaxAttempts,
    );
    // A row stored building/pending whose tasks are now running has just
    // succeeded — flag it for the reconcile + emit below.
    if (stats.status === "running" && (row.status === "building" || row.status === "pending")) {
      justSucceeded.push(row.id);
    }
    // A stale zero-task row the derivation gave up on: persist the failure so
    // the stored status (which the graph node + notifications read) agrees
    // with what the list shows, instead of a display-only "failed" over a
    // forever-"pending" row.
    if (
      stats.status === "failed" &&
      states.length === 0 &&
      (row.status === "building" || row.status === "pending")
    ) {
      justDied.push(row.id);
    }
    return stats;
  });

  if (justSucceeded.length > 0) {
    await reconcileDeploySuccess(justSucceeded, input.resourceId);
  }
  if (justDied.length > 0) {
    await reconcileDeployFailure(justDied);
  }
  return Result.ok(result);
}
