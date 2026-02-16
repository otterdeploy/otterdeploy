import { createLogger } from "@otterstack/logger";
import { deploymentMachine } from "@otterstack/domain";

import { inngest } from "../inngest";

const logger = createLogger("deployment-pipeline");

export const deploymentPipeline = inngest.createFunction(
  {
    id: "deployment-pipeline",
    concurrency: [
      {
        key: "event.data.orgId + ':' + event.data.resourceId + ':deploy'",
        limit: 1,
      },
    ],
    retries: 0,
    onFailure: async ({ event, error }) => {
      const deploymentId = event.data.event.data.deploymentId;

      logger.error(
        { deploymentId, err: error },
        "Deployment pipeline failed",
      );

      try {
        await deploymentMachine.transitionTo(deploymentId, "failed", {
          actor: "system",
          reason: "Pipeline execution failed",
          metadata: {
            error: error instanceof Error ? error.message : "Unknown worker failure",
          },
        });
      } catch (transitionErr) {
        logger.warn(
          { deploymentId, err: transitionErr },
          "Failed to transition deployment to failed after pipeline error",
        );
      }
    },
  },
  { event: "deployment.requested" },
  async ({ event, step }) => {
    const { deploymentId } = event.data;
    const actorUserId = event.data.actorUserId;

    // Step 1: Acquire slot (transition queued -> building)
    await step.run("acquire-slot", async () => {
      await deploymentMachine.transitionTo(deploymentId, "building", {
        actor: actorUserId,
        reason: "Build started",
      });
      logger.info({ deploymentId }, "Acquired build slot");
    });

    // Step 2: Clone + Build (skip for rollbacks)
    if (event.data.source !== "rollback") {
      await step.run("build-image", async () => {
        // TODO: BuildAdapter integration (Wave 2 infra)
        // NOT implementing secret resolution here
        logger.info({ deploymentId }, "Building image (stub)");
      });
    }

    // Step 3: Transition to deploying
    await step.run("start-deploy", async () => {
      await deploymentMachine.transitionTo(deploymentId, "deploying", {
        actor: "system",
        reason: "Deploy started",
      });
      logger.info({ deploymentId }, "Deploying container (stub)");
    });

    // Step 4: Transition to verifying
    await step.run("verify-health", async () => {
      await deploymentMachine.transitionTo(deploymentId, "verifying", {
        actor: "system",
        reason: "Health check started",
      });
      // TODO: health check polling
      logger.info({ deploymentId }, "Verifying health (stub)");
    });

    // Step 5: Finalize (transition -> live)
    await step.run("finalize", async () => {
      await deploymentMachine.transitionTo(deploymentId, "live", {
        actor: "system",
        reason: "Deployment successful",
      });
      logger.info({ deploymentId }, "Deployment finalized");
    });
  },
);
