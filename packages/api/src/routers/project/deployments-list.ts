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
import { deployment } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { DeploymentRow } from "./deployments";
import type { DerivedDeploymentStatus, InstanceGlimpse } from "./deployments-derive";

import { loadPreviewScope } from "../../lib/environment/load";
import { runtimeServiceName } from "../../lib/environment/scoping";
import { deriveDeploymentStatus, FAILED_TASK_COUNT_STATES } from "./deployments-derive";
import {
  isBuildStillLogging,
  reconcileDeployFailure,
  reconcileDeploySuccess,
} from "./deployments-reconcile";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { getProjectInOrg, getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { listResourceInstances } from "./resource-instances";
import { buildContainerName } from "./views";

type OrgId = OrganizationId;
type ResolvedResource = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;

export { deriveDeploymentStatus } from "./deployments-derive";
export type { DerivedDeploymentStatus } from "./deployments-derive";
// Settlement writers moved to a sibling under the file cap; re-exported so
// call sites keep importing from the list module.
export {
  isBuildStillLogging,
  reconcileDeployFailure,
  reconcileDeploySuccess,
} from "./deployments-reconcile";

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
  sourceSha: string | null;
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

// Resolve the swarm service name backing a resource — postgres uses the
// deterministic container-name pattern; services store it on the row. A
// compose STACK returns null: its containers carry the per-service (child)
// deployment ids, never the stack row's, so there's no single service to
// refine the stack's rows against — they keep their stored status.
export async function resolveDeploymentServiceName(
  found: ResolvedResource,
  projectId: ProjectId,
): Promise<string | null> {
  if (found.kind === "database") {
    const proj = await getProjectRecord(projectId);
    const slug = proj?.slug ?? projectId;
    return buildContainerName({
      engine: found.record.database.engine,
      projectSlug: slug,
      resourceName: found.record.resource.name,
    });
  }
  if (found.kind === "service") return found.record.service.serviceName;
  return null;
}

// One runtime-aware call covers every instance for the service (swarm tasks or
// plain-docker containers). Bucket them by the `otterdeploy.deployment.id`
// label so we never need a per-deployment call. `withInspect` fills exit code /
// restart count / OOM flag under plain docker — the derivation needs those to
// tell a crash that gave up from an operator stop.
export async function loadTaskStatesByDeployment(
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
  // Compose stacks have no single restart policy (N child services) — leave
  // the cap unknown.
  if (found.kind !== "service") return null;
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
    sourceSha: row.sourceSha,
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
  if (serviceName && input.previewId) {
    // Preview deployments run under the pr-suffixed container — derive task
    // states from THAT name or every preview row reads as zero tasks.
    const scope = await loadPreviewScope(input.previewId);
    if (scope) serviceName = runtimeServiceName(serviceName, scope);
  }
  // Compose stack rows have no task-level refinement (null serviceName) —
  // they read back the status deployCompose stored.
  const tasksByDeployment = serviceName
    ? await loadTaskStatesByDeployment(serviceName)
    : new Map<string, InstanceGlimpse[]>();

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
    // A stale zero-task row the derivation gave up on: persist the failure so
    // the stored status (which the graph node + notifications read) agrees
    // with what the list shows, instead of a display-only "failed" over a
    // forever-"pending" row. Base listings only — preview rows settle via the
    // builder.
    if (
      !input.previewId &&
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
