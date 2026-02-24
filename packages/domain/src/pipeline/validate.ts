import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { DeploymentContext, PipelineDeps, ValidateOutput } from "./types";

const log = createLogger("pipeline:validate");

/**
 * Step 1: Validate deployment.
 * - Fetches deployment, resource, environment, project from DB
 * - Checks no other active deployment conflicts for this resource
 * - Transitions queued -> building
 * - Returns all config needed by subsequent steps
 */
export async function validateDeployment(
  ctx: DeploymentContext,
  deps: PipelineDeps,
): Promise<Result<ValidateOutput, Error>> {
  try {
    const { deploymentId, resourceId } = ctx;

    // Fetch deployment record
    const deployment = await deps.getDeployment(deploymentId);
    if (!deployment) {
      return Result.err(new Error(`Deployment not found: ${deploymentId}`));
    }

    // Fetch resource, project, environment in parallel
    const [resource, project, environment, gitRepo] = await Promise.all([
      deps.getResource(deployment.resourceId),
      deps.getProject(deployment.projectId),
      deps.getEnvironment(deployment.environmentId),
      deps.getGitRepository(deployment.resourceId),
    ]);

    if (!resource) {
      return Result.err(new Error(`Resource not found: ${deployment.resourceId}`));
    }
    if (!project) {
      return Result.err(new Error(`Project not found: ${deployment.projectId}`));
    }
    if (!environment) {
      return Result.err(new Error(`Environment not found: ${deployment.environmentId}`));
    }

    // Check for conflicting active deployments (building/deploying/verifying)
    const activeDeployments = await deps.getActiveDeploymentsForResource(
      resourceId,
      deploymentId,
    );

    const conflicting = activeDeployments.filter(
      (d) => d.status === "building" || d.status === "deploying" || d.status === "verifying",
    );

    if (conflicting.length > 0) {
      return Result.err(
        new Error(
          `Conflicting deployment(s) for resource ${resourceId}: ${conflicting.map((d) => `${d.id} (${d.status})`).join(", ")}`,
        ),
      );
    }

    // Transition queued -> building
    const transitionResult = await deps.transitionTo(deploymentId, "building", {
      actor: ctx.actorUserId,
      reason: "Build started",
    });
    if (transitionResult.isErr()) {
      return Result.err(
        transitionResult.error instanceof Error
          ? transitionResult.error
          : new Error(String(transitionResult.error)),
      );
    }

    const builder = deployment.builder ?? resource.builder ?? "nixpacks";

    log.info(
      { deploymentId, resourceId, builder },
      "Deployment validated, transitioned to building",
    );

    return Result.ok({
      deployment: ctx,
      resource,
      project,
      environment,
      gitRepo,
      builder,
      imageTag: deployment.imageTag,
      previousImageTag: deployment.previousImageTag,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: ctx.deploymentId }, "Validation failed");
    return Result.err(err);
  }
}
