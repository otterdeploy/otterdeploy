import { createLogger } from "@otterdeploy/logger";
import { deploymentMachine } from "@otterdeploy/domain";
import {
  validateDeployment,
  cloneSource,
  resolveSecrets,
  buildImage,
  runPreDeployCommand,
  deploySwarmService,
  waitForHealthy,
  routeTraffic,
  verifyDeployment,
  cleanupBuild,
} from "@otterdeploy/domain/pipeline";
import { Result } from "better-result";

import { inngest } from "../inngest";
import {
  createPipelineDeps,
  createCloneDeps,
  createResolveSecretsDeps,
  createBuildDeps,
  createPreDeployDeps,
  createDeployDeps,
  createHealthCheckDeps,
  createRouteTrafficDeps,
  createVerifyDeps,
  createCleanupDeps,
} from "./pipeline-deps";

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

      logger.error({ deploymentId, err: error }, "Deployment pipeline failed");

      const transitionResult = await Result.tryPromise({
        try: () =>
          deploymentMachine.transitionTo(deploymentId, "failed", {
            actor: "system",
            reason: "Pipeline execution failed",
            metadata: {
              error: error instanceof Error ? error.message : "Unknown worker failure",
            },
          }),
        catch: (transitionErr) => transitionErr,
      });
      if (transitionResult.isErr()) {
        logger.warn(
          { deploymentId, err: transitionResult.error },
          "Failed to transition deployment to failed after pipeline error",
        );
      }
    },
  },
  { event: "deployment.requested" },
  async ({ event, step }) => {
    const { deploymentId, resourceId, environmentId } = event.data;
    const actorUserId = event.data.actorUserId;
    const orgId = event.data.orgId;
    const source = event.data.source;
    const correlationId = event.data.correlationId;

    const pipelineDeps = createPipelineDeps();

    // Step 1: Validate — check conflicts, fetch config, transition queued -> building
    const validated = await step.run("validate", async () => {
      const deployment = await pipelineDeps.getDeployment(deploymentId);
      if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);

      const result = await validateDeployment(
        {
          deploymentId,
          organizationId: orgId,
          projectId: deployment.projectId,
          environmentId,
          resourceId,
          actorUserId,
          source,
          correlationId,
        },
        pipelineDeps,
      );

      if (result.isErr()) throw result.error;
      return result.value;
    });

    // Step 2: Clone — git clone to /tmp/otterstack-builds/{deploymentId}/
    const cloneResult = await step.run("clone", async () => {
      const result = await cloneSource(
        {
          deploymentId,
          builder: validated.builder,
          gitRepo: validated.gitRepo,
          gitCommitSha: undefined, // Use branch HEAD
        },
        createCloneDeps(),
      );

      if (result.isErr()) throw result.error;
      return result.value;
    });

    // Step 3: Resolve secrets — env var resolution + snapshot
    const secrets = await step.run("resolve-secrets", async () => {
      const result = await resolveSecrets(
        {
          deploymentId,
          organizationId: orgId,
          projectId: validated.project.id,
          environmentId: validated.environment.id,
          resourceId,
        },
        createResolveSecretsDeps(),
      );

      if (result.isErr()) throw result.error;
      return result.value;
    });

    // Step 4: Build — dispatch to builder, tag image
    // Skip for rollbacks that already have an image tag
    const buildResult = await step.run("build", async () => {
      // Determine deployment number from the image tag or generate one
      const deploymentNumber = Date.now(); // Unique monotonic number

      const result = await buildImage(
        {
          deploymentId,
          resourceId,
          builder: validated.builder,
          sourceDir: cloneResult.sourceDir,
          buildTimeEnv: secrets.buildTime,
          resource: validated.resource,
          deploymentNumber,
          force: false,
          existingImageTag: source === "rollback" ? validated.imageTag : null,
        },
        createBuildDeps(),
      );

      if (result.isErr()) throw result.error;
      return result.value;
    });

    // Step 5: Pre-deploy command — optional command in temp container
    await step.run("pre-deploy", async () => {
      const result = await runPreDeployCommand(
        {
          deploymentId,
          preDeployCommand: validated.resource.preDeployCommand,
          fullImage: buildResult.fullImage,
          runtimeEnv: secrets.runtime,
        },
        createPreDeployDeps(),
      );

      if (result.isErr()) throw result.error;
    });

    // Step 6: Deploy — create/update Swarm service (blue-green)
    await step.run("deploy", async () => {
      const result = await deploySwarmService(
        {
          deploymentId,
          fullImage: buildResult.fullImage,
          runtimeEnv: secrets.runtime,
          resource: validated.resource,
          project: validated.project,
          environment: validated.environment,
          organizationId: orgId,
          actorUserId,
        },
        createDeployDeps(),
      );

      if (result.isErr()) throw result.error;
    });

    // Step 7: Health check — poll container health
    await step.run("health-check", async () => {
      const result = await waitForHealthy(
        {
          deploymentId,
          resourceId,
        },
        createHealthCheckDeps(),
      );

      if (result.isErr()) throw result.error;
    });

    // Step 8: Route traffic — push Caddy routes
    await step.run("route-traffic", async () => {
      const result = await routeTraffic(
        {
          deploymentId,
          resourceId,
        },
        createRouteTrafficDeps(pipelineDeps),
      );

      if (result.isErr()) throw result.error;
    });

    // Step 9: Verify — transition to live, emit deployment.released
    await step.run("verify", async () => {
      const result = await verifyDeployment(
        {
          deploymentId,
          organizationId: orgId,
          environmentId: validated.environment.id,
          resourceId,
          baseDomain: validated.project.baseDomain,
          resourceName: validated.resource.name,
          projectSlug: validated.project.slug,
          correlationId,
        },
        createVerifyDeps(),
      );

      if (result.isErr()) throw result.error;
    });

    // Step 10: Cleanup — remove build dir, prune old tags
    await step.run("cleanup", async () => {
      await cleanupBuild(
        {
          deploymentId,
          resourceId,
          sourceDir: cloneResult.sourceDir,
        },
        createCleanupDeps(),
      );
      // Cleanup errors are non-fatal, already handled inside cleanupBuild
    });

    logger.info({ deploymentId }, "Deployment pipeline completed successfully");
  },
);
