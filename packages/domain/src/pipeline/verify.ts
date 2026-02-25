import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { PipelineDeps } from "./types";

const log = createLogger("pipeline:verify");

export interface VerifyDeps {
  /**
   * Transition the deployment to a new status.
   */
  transitionTo: PipelineDeps["transitionTo"];

  /**
   * Publish a deployment.released event.
   */
  publishDeploymentReleased: (input: {
    orgId: string;
    deploymentId: string;
    resourceId: string;
    environmentId: string;
    releasedUrl: string | null;
    correlationId?: string;
  }) => Promise<Result<void, Error>>;
}

/**
 * Step 9: Verify and finalize.
 * - Transitions deploying -> verifying -> live
 * - Records completedAt and duration on the deployment
 * - Emits a deployment.released event
 *
 * Idempotent: transitions are no-ops if already in target state.
 */
export async function verifyDeployment(
  input: {
    deploymentId: string;
    organizationId: string;
    environmentId: string;
    resourceId: string;
    baseDomain: string | null;
    resourceName: string;
    projectSlug: string;
    correlationId?: string;
  },
  deps: VerifyDeps,
): Promise<Result<void, Error>> {
  try {
    const { deploymentId } = input;

    // Transition deploying -> verifying
    const verifyTransition = await deps.transitionTo(deploymentId, "verifying", {
      actor: "system",
      reason: "Health check passed, verifying",
    });
    if (verifyTransition.isErr()) {
      return Result.err(
        verifyTransition.error instanceof Error
          ? verifyTransition.error
          : new Error(String(verifyTransition.error)),
      );
    }

    // Transition verifying -> live (this also sets completedAt and duration via the machine)
    const liveTransition = await deps.transitionTo(deploymentId, "live", {
      actor: "system",
      reason: "Deployment successful",
    });
    if (liveTransition.isErr()) {
      return Result.err(
        liveTransition.error instanceof Error
          ? liveTransition.error
          : new Error(String(liveTransition.error)),
      );
    }

    // Construct the released URL if a base domain is configured
    const releasedUrl = input.baseDomain
      ? `https://${input.resourceName}.${input.projectSlug}.${input.baseDomain}`
      : null;

    // Emit deployment.released event
    const publishResult = await deps.publishDeploymentReleased({
      orgId: input.organizationId,
      deploymentId,
      resourceId: input.resourceId,
      environmentId: input.environmentId,
      releasedUrl,
      correlationId: input.correlationId,
    });

    if (publishResult.isErr()) {
      log.warn(
        { err: publishResult.error, deploymentId },
        "Failed to publish deployment.released event (non-fatal)",
      );
    }

    log.info({ deploymentId, releasedUrl }, "Deployment verified and live");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Verification failed");
    return Result.err(err);
  }
}
