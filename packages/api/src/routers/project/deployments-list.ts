/**
 * Read-side of the deployment API. Status is derived live from the underlying
 * swarm tasks when the UI reads the list (no background updater — see
 * `listResourceDeployments`), then the building/pending → running flip is
 * persisted lazily and `deploy.succeeded` emitted exactly once. The pure
 * task-states → status mapping lives in ./deployments-status (re-exported
 * here).
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
import type { DeploymentWithStats } from "./deployments-status";

import { loadPreviewScope } from "../../lib/environment/load";
import { runtimeServiceName } from "../../lib/environment/scoping";
import { emitDeploySucceeded } from "./deployments-emit";
import { toDeploymentWithStats, ZERO_TASK_STALE_MS } from "./deployments-status";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { publishResourceChanged } from "./project-event-bus";
import { getProjectInOrg, getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { listResourceInstances } from "./resource-instances";
import { buildContainerName } from "./views";

export {
  deriveDeploymentStatus,
  type DeploymentWithStats,
  type DerivedDeploymentStatus,
} from "./deployments-status";

type OrgId = OrganizationId;
type ResolvedResource = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;

// A git-source deployment legitimately has ZERO tasks for its whole image
// build — nothing is scheduled until build+push finishes — so age alone
// can't distinguish "dead" from "slow build". The build streams log lines
// the entire time it runs (BuildKit progress alone keeps this fresh), so a
// recent log line means the builder is alive and the row stays "building".
const BUILD_LOG_QUIET_MS = 3 * 60_000;

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
