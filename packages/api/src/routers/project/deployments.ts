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
 * That's how `listTasksForDeployment` groups task history into deployments.
 *
 * Status starts at "pending"/"building" and is derived live from the
 * underlying tasks when the UI reads the list — see `listResourceDeployments`
 * in ./deployments-list. The notification emitters live in ./deployments-emit.
 */
import type { DeploymentId, OrganizationId, PreviewId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, project, resource } from "@otterdeploy/db/schema/project";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { emitPlatformEvent } from "../../notifications/emit";
import { emitDeployStarted } from "./deployments-emit";
import { publishResourceChanged } from "./project-event-bus";

export interface DeploymentRow {
  id: DeploymentId;
  resourceId: ResourceId;
  image: string;
  reason:
    | "create"
    | "redeploy"
    | "env-change"
    | "image-change"
    | "restart"
    | "git-push"
    | "rollback";
  status: "pending" | "building" | "running" | "failed" | "superseded" | "removed";
  /** Full resource config at the moment of this deploy. Used by rollback to
   *  reproduce the prior state — service env, ports, command, healthcheck,
   *  database extraEnv + publicEnabled, etc. Shape is kind-specific and
   *  validated at the rollback site, not here. */
  snapshot: Record<string, unknown>;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  errorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InsertInput {
  resourceId: ResourceId;
  image: string;
  reason: DeploymentRow["reason"];
  /** Preview scoping. Omitted → NULL (a normal base deployment). Preview
   *  deploys pass their preview id. */
  previewId?: PreviewId;
  /** Initial lifecycle status. Defaults to "building" (git-sourced deploys go
   *  straight into a build). Deploys that never build — compose stacks rolling
   *  out prebuilt/pulled images — pass "pending" so the UI doesn't claim a
   *  build is happening. */
  status?: "pending" | "building";
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
      previewId: input.previewId,
      status: input.status ?? "building",
      snapshot: input.snapshot,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to insert deployment row");
  }

  await emitDeployStarted({
    deploymentId: row.id,
    resourceId: input.resourceId,
    reason: input.reason,
  });

  // Push the new "building" deployment to the project stream so the node +
  // panel flip instantly (no 5s poll wait).
  void publishResourceChanged(input.resourceId);

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

  // Fan a deploy.failed event out to subscribed notification channels.
  // Best-effort: emitPlatformEvent never throws into this path.
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceId: deployment.resourceId,
      resourceName: resource.name,
      projectName: project.name,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId));
  if (info) {
    // Real-time: flip the node/panel to "failed" without waiting for a poll.
    void publishResourceChanged(info.resourceId);
    await emitPlatformEvent({
      organizationId: info.organizationId as OrganizationId,
      eventId: "deploy.failed",
      title: "Deploy failed",
      message: `${info.resourceName}: ${errorMessage}`,
      data: {
        deploymentId,
        resource: info.resourceName,
        project: info.projectName,
      },
    });
  }
}

/** Drop a deployment row. Used by the recovery path in
 *  `ensureSwarmRuntimeForRecord` when the would-be `restart` deployment
 *  turned out to be a no-op (the swarm service was already there by the
 *  time provisioning ran). Leaving the row would leave the UI's
 *  Deployments tab stuck on a 0-task `building` entry forever, because
 *  no task ever inherits its deployment.id label. */
export async function deleteDeploymentById(deploymentId: DeploymentId): Promise<void> {
  await db.delete(deployment).where(eq(deployment.id, deploymentId));
}

/** The most-recent deployment for a resource (stored row status, no docker).
 *  Cheap single-row read — the service-resource view uses it so the graph
 *  node can reflect build-time states (pending/building/failed) that produce
 *  zero swarm tasks and so never show up in the live-task rollup. */
export async function getLatestDeploymentForResource(
  resourceId: ResourceId,
  // Base rows by default — a PR preview's deployments must not surface as the
  // production card's "latest". Pass the preview id to read that scope.
  previewId: PreviewId | null = null,
): Promise<DeploymentRow | null> {
  const [row] = await db
    .select()
    .from(deployment)
    .where(
      and(
        eq(deployment.resourceId, resourceId),
        previewId ? eq(deployment.previewId, previewId) : isNull(deployment.previewId),
      ),
    )
    .orderBy(desc(deployment.createdAt))
    .limit(1);
  return (row as DeploymentRow | undefined) ?? null;
}

/** Latest BASE deployment per resource for a SET of resources — one query
 *  instead of N `getLatestDeploymentForResource` calls (the project-resources
 *  list fired one per resource). `DISTINCT ON (resourceId)` with a
 *  resourceId-then-createdAt-desc order picks the newest row per resource.
 *  Returns a map keyed by resourceId; resources with no deployment are absent. */
export async function getLatestDeploymentsForResources(
  resourceIds: ReadonlyArray<ResourceId>,
): Promise<Map<ResourceId, DeploymentRow>> {
  const result = new Map<ResourceId, DeploymentRow>();
  if (resourceIds.length === 0) return result;
  const rows = await db
    .selectDistinctOn([deployment.resourceId])
    .from(deployment)
    .where(
      and(inArray(deployment.resourceId, resourceIds as ResourceId[]), isNull(deployment.previewId)),
    )
    .orderBy(deployment.resourceId, desc(deployment.createdAt));
  for (const row of rows) result.set(row.resourceId as ResourceId, row as DeploymentRow);
  return result;
}

/** Load one deployment by id, scoped to its resource. Returns null when the
 *  row is missing or belongs to a different resource — the scope guard keeps
 *  rollback from replaying another resource's image. */
export async function getResourceDeploymentById(
  resourceId: ResourceId,
  deploymentId: DeploymentId,
): Promise<DeploymentRow | null> {
  const [row] = await db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.resourceId, resourceId)))
    .limit(1);
  return (row as DeploymentRow | undefined) ?? null;
}

// ─── Re-exports — keep the deployments.* import surface stable ────────────
export { emitDeployStarted } from "./deployments-emit";
export {
  listResourceDeployments,
  reconcileDeploySuccess,
  type DeploymentWithStats,
} from "./deployments-list";
export { listTasksForDeployment, type DeploymentTaskInfo } from "./deployments-tasks";
