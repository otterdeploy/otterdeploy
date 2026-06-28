/**
 * Image-only rollback for the Service primitive. Split out of handlers.ts to
 * keep that file under the line cap; re-exported from there so the router
 * import path is unchanged.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ProjectNotFoundError } from "../project/errors";

import {
  getResourceDeploymentById,
  insertDeployment,
  markDeploymentFailed,
} from "../project/deployments";
import { loadResource } from "./context";
import { NotRollbackableError, ServiceNotFoundError, type ResolveError } from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { redeployAndFanOut } from "./redeploy";
import { type ServiceView } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

/**
 * Roll a service back to a prior deployment's image. Image-only: it re-points
 * `serviceResource.image` at the target deployment's tag and re-rolls — the
 * service's current env/config/secrets are kept (you want the old code with
 * today's config, not an old env that may reference deleted resources). The
 * roll is recorded as a new `reason:"rollback"` deployment so it shows in
 * history and can itself be rolled back. The target must be a settled deploy
 * with a real (non-`pending:`) image.
 */
export async function rollbackService(
  input: ResourceRef & { deploymentId: DeploymentId },
  log: RequestLogger,
): Promise<Result<ServiceView, RedeployFailure | NotRollbackableError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const target = await getResourceDeploymentById(input.resourceId, input.deploymentId);
  if (!target) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }
  if (target.status !== "running" && target.status !== "superseded") {
    return Result.err(
      new NotRollbackableError({
        resourceId: input.resourceId,
        reason: `deployment is ${target.status}, not a settled successful deploy`,
      }),
    );
  }
  if (!target.image || target.image.startsWith("pending:")) {
    return Result.err(
      new NotRollbackableError({
        resourceId: input.resourceId,
        reason: "deployment has no built image",
      }),
    );
  }

  const previousImage = ctx.value.record.service.image;
  // Pin by the target's tag; clear the digest (the deployment row stores no
  // digest, and the tag still resolves the rolled-back image).
  await db
    .update(serviceResource)
    .set({ image: target.image, imageDigest: null })
    .where(eq(serviceResource.resourceId, input.resourceId));

  const row = await insertDeployment({
    resourceId: input.resourceId,
    image: target.image,
    reason: "rollback",
    snapshot: {
      rolledBackToDeploymentId: target.id,
      previousImage,
    },
  });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) {
    await markDeploymentFailed(row.id, redeployed.error.message);
    return Result.err(redeployed.error);
  }

  await db
    .update(deployment)
    .set({ status: "running", completedAt: new Date() })
    .where(eq(deployment.id, row.id));

  return getService(input);
}
