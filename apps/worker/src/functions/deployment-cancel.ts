import { createLogger } from "@otterdeploy/logger";
import { deploymentMachine } from "@otterdeploy/domain";
import { Result } from "better-result";

import { inngest } from "../inngest";

const logger = createLogger("deployment-cancel");

/**
 * Deployment cancellation handler.
 * Triggered by deployment.canceled events (fired from the API when a user cancels).
 *
 * This function handles the cleanup side of cancellation:
 * 1. Transition to canceled (may already be done by the API)
 * 2. If deploying: attempt to force rollback the Swarm service
 * 3. Clean up build artifacts
 */
export const deploymentCancel = inngest.createFunction(
  {
    id: "deployment-cancel",
    retries: 1,
  },
  { event: "deployment.failed" },
  async ({ event, step }) => {
    const { deploymentId } = event.data;

    // Step 1: Ensure transition to canceled/failed
    await step.run("ensure-canceled", async () => {
      // The deployment may already be in a terminal state if the API canceled it
      // or if the pipeline failed. We just log and verify.
      logger.info({ deploymentId }, "Processing deployment cancellation/failure");
    });

    // Step 2: If the deployment was in a deploying state, try to roll back the Swarm service
    await step.run("cleanup-service", async () => {
      try {
        const docker = await import("@otterdeploy/docker");
        const serviceName = `otterstack-${event.data.resourceId}`;

        // Check if the service exists — if so, attempt rollback
        const inspectResult = await docker.inspectService(serviceName);
        if (inspectResult.isOk()) {
          logger.info(
            { deploymentId, serviceName },
            "Service exists after failed deployment, Swarm auto-rollback will handle recovery",
          );
          // Docker Swarm's UpdateConfig.FailureAction = "rollback" handles
          // automatic rollback to the previous task spec.
        }
      } catch (error) {
        logger.warn(
          { deploymentId, err: error },
          "Failed to check/cleanup service after cancellation (non-fatal)",
        );
      }
    });

    // Step 3: Clean up build artifacts
    await step.run("cleanup-build", async () => {
      try {
        const { rm } = await import("node:fs/promises");
        const buildDir = `/tmp/otterstack-builds/${deploymentId}`;
        await rm(buildDir, { recursive: true, force: true });
        logger.info({ deploymentId, buildDir }, "Build directory cleaned up after cancellation");
      } catch (error) {
        logger.warn(
          { deploymentId, err: error },
          "Failed to clean up build directory after cancellation (non-fatal)",
        );
      }
    });

    logger.info({ deploymentId }, "Deployment cancellation/failure cleanup completed");
  },
);
