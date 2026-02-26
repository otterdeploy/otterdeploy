import { createLogger } from "@otterdeploy/logger";
import {
  deploymentMachine,
  deploymentService,
  deploymentLogService,
} from "@otterdeploy/domain";
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
import { db, eq } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { createProjectNetwork } from "@otterdeploy/docker";

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
      const resourceId = event.data.event.data.resourceId;

      logger.error({ deploymentId, err: error }, "Deployment pipeline failed");
      await deploymentLogService.appendDeploymentLog({
        deploymentId,
        level: "error",
        tab: "deploy",
        message:
          error instanceof Error
            ? `deployment failed: ${error.message}`
            : "deployment failed: unknown worker error",
      });

      // Mark resource as crashed
      await db
        .update(resource)
        .set({ status: "crashed", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));

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

    const appendLog = async (
      message: string,
      options?: { level?: "debug" | "info" | "warn" | "error"; tab?: "build" | "deploy" | "runtime" },
    ) => {
      const result = await deploymentLogService.appendDeploymentLog({
        deploymentId,
        message,
        level: options?.level,
        tab: options?.tab,
      });
      if (result.isErr()) {
        logger.warn(
          { deploymentId, err: result.error },
          "Failed to append deployment log line",
        );
      }
    };

    const runPipelineStep = async <T>(
      stepName: string,
      fn: () => Promise<T>,
      options?: { tab?: "build" | "deploy" | "runtime" },
    ): Promise<T> => {
      const output = await step.run(stepName, async () => {
        await appendLog(`${stepName}: started`, { tab: options?.tab ?? "deploy" });
        try {
          const stepOutput = await fn();
          await appendLog(`${stepName}: completed`, { tab: options?.tab ?? "deploy" });
          return stepOutput;
        } catch (error) {
          await appendLog(
            `${stepName}: failed - ${error instanceof Error ? error.message : String(error)}`,
            { level: "error", tab: options?.tab ?? "deploy" },
          );
          throw error;
        }
      });
      return output as T;
    };

    const ensureLogResult = await deploymentLogService.ensureDeploymentLog({
      deploymentId,
    });
    if (ensureLogResult.isErr()) {
      logger.warn(
        { deploymentId, err: ensureLogResult.error },
        "Failed to initialize deployment log file",
      );
    } else {
      await appendLog("deployment pipeline started", { tab: "deploy" });
    }

    // Step 1: Validate — check conflicts, fetch config, transition queued -> building
    const validated = await runPipelineStep(
      "validate",
      async () => {
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
      },
      { tab: "deploy" },
    );

    // Step 2: Ensure environment network exists
    await runPipelineStep(
      "ensure-network",
      async () => {
      const result = await createProjectNetwork(validated.project.id, validated.environment.id);
      if (result.isErr()) throw result.error;
      },
      { tab: "deploy" },
    );

    // Step 3: Clone — git clone to /tmp/otterstack-builds/{deploymentId}/
    const cloneResult = await runPipelineStep(
      "clone",
      async () => {
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
      },
      { tab: "build" },
    );

    // Step 4: Resolve secrets — env var resolution + snapshot
    const secrets = await runPipelineStep(
      "resolve-secrets",
      async () => {
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
      },
      { tab: "build" },
    );

    // Step 5: Build — dispatch to builder, tag image
    // Skip for rollbacks that already have an image tag
    const buildResult = await runPipelineStep(
      "build",
      async () => {
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
          onLogLine: (line, stream) =>
            appendLog(line, {
              tab: "build",
              level: stream === "stderr" ? "warn" : "info",
            }),
        },
        createBuildDeps(),
      );

      if (result.isErr()) throw result.error;
      return result.value;
      },
      { tab: "build" },
    );

    // Step 6: Pre-deploy command — optional command in temp container
    await runPipelineStep(
      "pre-deploy",
      async () => {
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
      },
      { tab: "deploy" },
    );

    // Step 7: Deploy — create/update Swarm service (blue-green)
    await runPipelineStep(
      "deploy",
      async () => {
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
      },
      { tab: "deploy" },
    );

    // Step 8: Health check — poll container health
    await runPipelineStep(
      "health-check",
      async () => {
      const result = await waitForHealthy(
        {
          deploymentId,
          resourceId,
        },
        createHealthCheckDeps(),
      );

      if (result.isErr()) throw result.error;
      },
      { tab: "deploy" },
    );

    // Step 9: Route traffic — push Caddy routes
    await runPipelineStep(
      "route-traffic",
      async () => {
      const result = await routeTraffic(
        {
          deploymentId,
          resourceId,
        },
        createRouteTrafficDeps(pipelineDeps),
      );

      if (result.isErr()) throw result.error;
      },
      { tab: "deploy" },
    );

    // Step 10: Verify — transition to live, emit deployment.released
    await runPipelineStep(
      "verify",
      async () => {
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
      },
      { tab: "deploy" },
    );

    // Step 11: Retire previous live deployments → rolled_back
    await runPipelineStep(
      "retire-previous-deployments",
      async () => {
      const result = await deploymentService.retirePreviousDeployments(resourceId, deploymentId);
      if (result.isErr()) {
        logger.warn(
          { deploymentId, err: result.error },
          "Failed to retire previous deployments (non-fatal)",
        );
      }
      },
      { tab: "deploy" },
    );

    // Step 12: Mark resource as online
    await runPipelineStep(
      "update-resource-status",
      async () => {
      await db
        .update(resource)
        .set({ status: "online", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));
      },
      { tab: "deploy" },
    );

    // Step 13: Cleanup — remove build dir, prune old tags
    await runPipelineStep(
      "cleanup",
      async () => {
      await cleanupBuild(
        {
          deploymentId,
          resourceId,
          sourceDir: cloneResult.sourceDir,
        },
        createCleanupDeps(),
      );
      // Cleanup errors are non-fatal, already handled inside cleanupBuild
      },
      { tab: "build" },
    );

    logger.info({ deploymentId }, "Deployment pipeline completed successfully");
    await appendLog("deployment pipeline completed successfully", { tab: "deploy" });
  },
);
