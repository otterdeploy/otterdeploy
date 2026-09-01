/**
 * Deployment lifecycle: one row per logical "push" of a resource to swarm.
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
 * underlying tasks when the UI reads the list. See `listResourceDeployments`
 * in ./deployments-list. The notification emitters live in ./deployments-emit.
 */
import type { DeploymentId, PreviewId, ResourceId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { db } from "@otterdeploy/db";
import { deployment, project, resource } from "@otterdeploy/db/schema/project";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { emitPlatformEvent } from "../../notifications/emit";
import { emitDeployStarted, serviceSubject } from "./deployments-emit";
import { publishResourceChanged } from "./project-event-bus";

export interface DeploymentRow {
  id: DeploymentId;
  resourceId: ResourceId;
  /** The PR preview this row belongs to; null for base (production) rows. */
  previewId: PreviewId | null;
  image: string;
  reason:
    | "create"
    | "redeploy"
    | "env-change"
    | "image-change"
    | "restart"
    | "git-push"
    | "rollback";
  status: "pending" | "building" | "running" | "failed" | "cancelled" | "superseded" | "removed";
  /** Full resource config at the moment of this deploy. Used by rollback to
   *  reproduce the prior state: service env, ports, command, healthcheck,
   *  database extraEnv + publicEnabled, etc. Shape is kind-specific and
   *  validated at the rollback site, not here. */
  snapshot: JsonObject;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
  sourceSha: string | null;
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
   *  straight into a build). Deploys that never build. Compose stacks rolling
   *  out prebuilt/pulled images. Pass "pending" so the UI doesn't claim a
   *  build is happening. */
  status?: "pending" | "building";
  /** Snapshot the deployment is built from. Pass the resource's full
   *  current config so rollback can reapply it verbatim later. */
  snapshot: JsonObject;
  /** Provenance of the commit this deployment puts (or re-puts) into service.
   *  Builds resolve it from GitHub; a rollback inherits it from the deployment
   *  it restores, because the image it re-launches WAS built from that commit.
   *  Omitted for deploys with no commit behind them (databases, image pulls).
   *  The card then falls back to the resource's own mark. */
  git?: {
    sha?: string | null;
    ref?: string | null;
    commitMessage?: string | null;
    commitAuthor?: string | null;
    commitAuthorAvatar?: string | null;
  };
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
      gitSha: input.git?.sha ?? null,
      gitRef: input.git?.ref ?? null,
      gitCommitMessage: input.git?.commitMessage ?? null,
      gitCommitAuthor: input.git?.commitAuthor ?? null,
      gitCommitAuthorAvatar: input.git?.commitAuthorAvatar ?? null,
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

  return row;
}

/** Mark an existing deployment terminal (failed). Used when provisioning
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
      projectSlug: project.slug,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId));
  if (info) {
    // Real-time: flip the node/panel to "failed" without waiting for a poll.
    void publishResourceChanged(info.resourceId);
    // The column is an unbranded text FK; hasPrefix is a real narrowing check
    // (every org id is minted "org_…" by the auth generateId hook).
    if (!hasPrefix(info.organizationId, ID_PREFIX.organization)) return;
    await emitPlatformEvent({
      organizationId: info.organizationId,
      eventId: "deploy.failed",
      title: "Deploy failed",
      message: `${info.resourceName}: ${errorMessage}`,
      subject: serviceSubject(info.resourceId, info),
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
 *  Cheap single-row read. The service-resource view uses it so the graph
 *  node can reflect build-time states (pending/building/failed) that produce
 *  zero swarm tasks and so never show up in the live-task rollup. */
export async function getLatestDeploymentForResource(
  resourceId: ResourceId,
  // Base rows by default: a PR preview's deployments must not surface as the
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
  return row ?? null;
}

/** Latest BASE deployment per resource for a SET of resources. One query
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
    .where(and(inArray(deployment.resourceId, resourceIds), isNull(deployment.previewId)))
    .orderBy(deployment.resourceId, desc(deployment.createdAt));
  for (const row of rows) result.set(row.resourceId, row);
  return result;
}

/** The scope a deployment listing runs under: the given preview, or — for a
 *  deep link that only knows a deployment id — the scope of that row itself
 *  (its preview's listing when it belongs to one, the base listing otherwise). */
export async function resolveListingScope(input: {
  resourceId: ResourceId;
  previewId?: PreviewId | null;
  deploymentId?: DeploymentId | null;
}): Promise<PreviewId | null> {
  if (input.previewId) return input.previewId;
  if (!input.deploymentId) return null;
  const row = await getResourceDeploymentById(input.resourceId, input.deploymentId);
  return row?.previewId ?? null;
}

/** Load one deployment by id, scoped to its resource. Returns null when the
 *  row is missing or belongs to a different resource. The scope guard keeps
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
  return row ?? null;
}
