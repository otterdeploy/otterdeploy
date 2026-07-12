/**
 * Local-source deploys (`source: "upload"`). The CLI's `otterdeploy deploy` tars
 * the project and streams it to the control plane; the server stages the tarball
 * on the shared data dir and enqueues a build the same way a git push does —
 * only the source acquisition differs (extract a tarball vs. clone a repo).
 *
 * Split into two steps because the tarball path is keyed by the deployment id:
 *   1. createUploadDeployment — verify the service is org-owned + upload-sourced,
 *      insert a pending deployment row, return its id (so the caller knows where
 *      to stage the tarball: sourceTarballPath(projectId, deploymentId)).
 *   2. triggerUploadBuild — after the bytes are on disk, enqueue the build.
 * If staging fails between the two, the caller marks the row failed so it never
 * strands as a phantom `pending`.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, project, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { emitDeployStarted } from "./deployments";
import { publishResourceChanged } from "./project-event-bus";

export interface UploadDeploymentTarget {
  projectId: ProjectId;
  deploymentId: DeploymentId;
}

/**
 * Verify the resource is an upload-sourced service owned by `organizationId`,
 * then insert a pending deployment row and return the ids the caller needs to
 * stage the tarball. Returns a string error (mirroring enqueueGitBuild's
 * channel) for not-found / not-owned / wrong-source / insert failure.
 */
export async function createUploadDeployment(args: {
  resourceId: ResourceId;
  organizationId: OrganizationId;
}): Promise<Result<UploadDeploymentTarget, string>> {
  const [row] = await db
    .select({
      projectId: resource.projectId,
      organizationId: project.organizationId,
      source: serviceResource.source,
    })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(serviceResource.resourceId, args.resourceId))
    .limit(1);

  if (!row || row.organizationId !== args.organizationId) {
    return Result.err("service not found");
  }
  if (row.source !== "upload") {
    return Result.err(`service is source "${row.source}", not "upload"`);
  }

  const [inserted] = await db
    .insert(deployment)
    .values({
      resourceId: args.resourceId,
      // Rewritten to the real image tag by the builder once built.
      image: "pending:upload",
      reason: "create" as const,
      status: "pending" as const,
      // No git identity for an uploaded source — the row keys the tarball path
      // by (projectId, deploymentId), not a sha.
    })
    .returning({ id: deployment.id });
  if (!inserted) return Result.err("failed to insert deployment row");

  return Result.ok({ projectId: row.projectId as ProjectId, deploymentId: inserted.id });
}

/**
 * Record the content hash of the staged tarball on the deployment row. The
 * source: "upload" analog of a commit sha — surfaced in the build log and the
 * deployment history so a local deploy has a stable content identifier. Called
 * after the bytes are on disk and before the build is enqueued (the builder
 * reads it off the row). Best-effort: a failure here must not block the deploy.
 */
export async function setUploadDeploymentSourceSha(
  deploymentId: DeploymentId,
  sourceSha: string,
): Promise<void> {
  await db.update(deployment).set({ sourceSha }).where(eq(deployment.id, deploymentId));
}

/**
 * Enqueue the tarball build after the source has been staged to disk. The
 * builder reads sourceTarballPath(projectId, deploymentId) — no bytes travel
 * through Redis. On a queue outage the row is marked failed so it doesn't hang
 * as a phantom `pending` (same guard as the git path).
 */
export async function triggerUploadBuild(args: {
  target: UploadDeploymentTarget;
  resourceId: ResourceId;
  // Structural so both the oRPC RequestLogger and evlog's global `log` fit.
  log?: { set: (fields: Record<string, unknown>) => void };
}): Promise<Result<{ deploymentId: string }, string>> {
  const { projectId, deploymentId } = args.target;

  await emitDeployStarted({ deploymentId, resourceId: args.resourceId, reason: "create" });
  void publishResourceChanged(args.resourceId);

  const enqueued = await Result.tryPromise({
    try: () => triggerDeploy({ projectId, sourceKind: "tarball", deploymentIds: [deploymentId] }),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (enqueued.isErr()) {
    const message = `could not queue the build (is Redis/the builder running?): ${enqueued.error}`;
    const { markDeploymentFailed } = await import("./deployments");
    await markDeploymentFailed(deploymentId, message).catch(() => undefined);
    return Result.err(message);
  }
  args.log?.set({ uploadBuild: { resourceId: args.resourceId, deploymentId } });
  return Result.ok({ deploymentId });
}
