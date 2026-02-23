import { createLogger } from "@otterdeploy/logger";
import { deploymentMachine } from "@otterdeploy/domain";
import {
  waitForHealthy,
  routeTraffic,
} from "@otterdeploy/domain/pipeline";
import { Result } from "better-result";

import { inngest } from "../inngest";
import {
  createPipelineDeps,
  createDeployDeps,
  createHealthCheckDeps,
  createRouteTrafficDeps,
} from "./pipeline-deps";

const logger = createLogger("deployment-rollback");

/**
 * Deployment rollback function.
 * Triggered by deployment.rollback.requested events.
 *
 * 1. Look up target deployment's image tag
 * 2. Update Swarm service with the old image
 * 3. Health check
 * 4. Re-sync Caddy routes
 * 5. Create deployment event for rollback completion
 */
export const deploymentRollback = inngest.createFunction(
  {
    id: "deployment-rollback",
    concurrency: [
      {
        key: "event.data.orgId + ':' + event.data.resourceId + ':deploy'",
        limit: 1,
      },
    ],
    retries: 1,
    onFailure: async ({ event, error }) => {
      const deploymentId = event.data.event.data.deploymentId;
      logger.error({ deploymentId, err: error }, "Deployment rollback failed");

      await Result.tryPromise({
        try: () =>
          deploymentMachine.transitionTo(deploymentId, "failed", {
            actor: "system",
            reason: "Rollback failed",
            metadata: {
              error: error instanceof Error ? error.message : "Unknown rollback failure",
            },
          }),
        catch: (err) => err,
      });
    },
  },
  { event: "deployment.rollback.requested" },
  async ({ event, step }) => {
    const { deploymentId, resourceId, environmentId, orgId } = event.data;
    const actorUserId = event.data.actorUserId;

    const pipelineDeps = createPipelineDeps();
    const deployDeps = createDeployDeps();

    // Step 1: Look up target deployment's image tag and transition to deploying
    const rollbackInfo = await step.run("lookup-target", async () => {
      const deployment = await pipelineDeps.getDeployment(deploymentId);
      if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);

      const imageTag = deployment.imageTag;
      if (!imageTag) {
        throw new Error(`No image tag found on deployment ${deploymentId} for rollback`);
      }

      // Transition queued -> building -> deploying (fast-track for rollbacks)
      const buildResult = await pipelineDeps.transitionTo(deploymentId, "building", {
        actor: actorUserId,
        reason: "Rollback initiated",
      });
      if (buildResult.isErr()) throw buildResult.error;

      const deployResult = await pipelineDeps.transitionTo(deploymentId, "deploying", {
        actor: "system",
        reason: "Rolling back to previous image",
      });
      if (deployResult.isErr()) throw deployResult.error;

      const imageName = `otterstack-${resourceId}`;
      return {
        fullImage: `${imageName}:${imageTag}`,
        imageTag,
      };
    });

    // Step 2: Update Swarm service with old image
    await step.run("update-service", async () => {
      const serviceName = `otterstack-${resourceId}`;

      const updateResult = await deployDeps.updateService(serviceName, {
        image: rollbackInfo.fullImage,
      });

      if (updateResult.isErr()) throw updateResult.error;

      logger.info(
        { deploymentId, serviceName, image: rollbackInfo.fullImage },
        "Swarm service updated for rollback",
      );
    });

    // Step 3: Health check
    await step.run("health-check", async () => {
      const result = await waitForHealthy(
        { deploymentId, resourceId },
        createHealthCheckDeps(),
      );
      if (result.isErr()) throw result.error;
    });

    // Step 4: Re-sync Caddy routes
    await step.run("route-traffic", async () => {
      const result = await routeTraffic(
        { deploymentId, resourceId },
        createRouteTrafficDeps(pipelineDeps),
      );
      if (result.isErr()) throw result.error;
    });

    // Step 5: Finalize — transition to live
    await step.run("finalize", async () => {
      const verifyResult = await pipelineDeps.transitionTo(deploymentId, "verifying", {
        actor: "system",
        reason: "Rollback health check passed",
      });
      if (verifyResult.isErr()) throw verifyResult.error;

      const liveResult = await pipelineDeps.transitionTo(deploymentId, "live", {
        actor: "system",
        reason: "Rollback completed",
      });
      if (liveResult.isErr()) throw liveResult.error;

      logger.info({ deploymentId }, "Rollback completed successfully");
    });
  },
);
