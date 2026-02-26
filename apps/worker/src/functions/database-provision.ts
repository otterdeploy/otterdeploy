import { createLogger } from "@otterdeploy/logger";
import {
  ConflictError,
  deploymentMachine,
  deploymentLogService,
} from "@otterdeploy/domain";
import {
  provisionDatabase,
  DATABASE_CONFIGS,
} from "@otterdeploy/domain/database-provisioner";
import { upsertEnvironmentVariable } from "@otterdeploy/domain/environment-variable";
import {
  stackDeploy,
  stackRemove,
  stackServices,
  createProjectNetwork,
} from "@otterdeploy/docker";
import { db, eq, desc } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { deployment } from "@otterdeploy/db/schema/deployment";
import { databaseConfig } from "@otterdeploy/db/schema/resource-config";
import { inngest } from "../inngest";

const logger = createLogger("database-provision");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeTransition(
  deploymentId: string,
  nextStatus: "building" | "deploying" | "verifying" | "live" | "failed",
  reason: string,
) {
  const transitionResult = await deploymentMachine.transitionTo(
    deploymentId,
    nextStatus,
    { actor: "system", reason },
  );

  if (transitionResult.isErr()) {
    const errorTag = (transitionResult.error as { _tag?: string })._tag;
    const isConflict =
      transitionResult.error instanceof ConflictError ||
      errorTag === "ConflictError";

    // Retries can race with prior attempts; ignore invalid transition conflicts.
    if (isConflict) return;
    logger.warn(
      { deploymentId, nextStatus, err: transitionResult.error },
      "Failed to transition deployment state",
    );
  }
}

export const databaseProvision = inngest.createFunction(
  {
    id: "database-provision",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const resourceId = event.data.event.data.resourceId;
      logger.error({ resourceId, err: error }, "Database provisioning failed");

      const latestDeployment = await db.query.deployment.findFirst({
        where: eq(deployment.resourceId, resourceId),
        orderBy: [desc(deployment.createdAt)],
      });
      if (latestDeployment) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId: latestDeployment.id,
          tab: "deploy",
          level: "error",
          message:
            error instanceof Error
              ? `database provisioning failed: ${error.message}`
              : "database provisioning failed",
        });
        const transitionResult = await deploymentMachine.transitionTo(
          latestDeployment.id,
          "failed",
          {
            actor: "system",
            reason:
              error instanceof Error
                ? error.message
                : "Database provisioning failed",
          },
        );
        if (transitionResult.isErr()) {
          const errorTag = (transitionResult.error as { _tag?: string })._tag;
          const isConflict =
            transitionResult.error instanceof ConflictError ||
            errorTag === "ConflictError";

          if (!isConflict) {
            logger.warn(
              { deploymentId: latestDeployment.id, err: transitionResult.error },
              "Failed to mark deployment as failed",
            );
          }
        }
      }

      await db
        .update(resource)
        .set({ status: "crashed", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));
    },
  },
  { event: "resource.created" },
  async ({ event, step }) => {
    const { resourceId, kind, orgId } = event.data;
    const deploymentIdFromEvent =
      "deploymentId" in event.data && typeof event.data.deploymentId === "string"
        ? event.data.deploymentId
        : null;
    const latestDeployment = await db.query.deployment.findFirst({
      where: eq(deployment.resourceId, resourceId),
      orderBy: [desc(deployment.createdAt)],
    });
    const deploymentId = deploymentIdFromEvent ?? latestDeployment?.id ?? null;

    // Only handle database resources
    if (kind !== "database") {
      return { skipped: true, reason: "Not a database resource" };
    }

    if (deploymentId) {
      await deploymentLogService.ensureDeploymentLog({ deploymentId });
      await deploymentLogService.appendDeploymentLog({
        deploymentId,
        tab: "deploy",
        message: `database provisioning started for resource ${resourceId}`,
      });
      await safeTransition(deploymentId, "building", "Database provision started");
      await safeTransition(deploymentId, "deploying", "Deploying database service");
    }

    // Ensure the project network exists before deploying the stack
    await step.run("ensure-network", async () => {
      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "ensure-network: creating project network",
        });
      }
      const networkResult = await createProjectNetwork(
        event.data.projectId,
        event.data.environmentId,
      );
      if (networkResult.isErr()) throw networkResult.error;
      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "ensure-network: completed",
        });
      }
    });

    const result = await step.run("provision-database", async () => {
      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "provision-database: started",
        });
      }
      const row = await db.query.resource.findFirst({
        where: eq(resource.id, resourceId),
        with: {
          databaseConfig: true,
          environment: {
            columns: { id: true, slug: true },
            with: {
              project: {
                columns: { id: true, slug: true },
              },
            },
          },
        },
      });
      if (!row?.databaseConfig) {
        throw new Error(`No database config found for resource ${resourceId}`);
      }

      const deps = {
        stackDeploy,
        stackRemove,
        stackServices,
        sleep,
      };

      const provisionResult = await provisionDatabase(
        {
          resourceId,
          projectId: event.data.projectId,
          environmentId: event.data.environmentId,
          projectSlug: row.environment?.project?.slug ?? event.data.projectId,
          environmentSlug: row.environment?.slug ?? event.data.environmentId,
          organizationId: orgId,
          dbType: row.databaseConfig.databaseType,
          onLogLine: deploymentId
            ? (line, stream) =>
                void deploymentLogService.appendDeploymentLog({
                  deploymentId,
                  tab: "deploy",
                  level: stream === "stderr" ? "warn" : "info",
                  message: line,
                })
            : undefined,
        },
        deps,
      );

      if (provisionResult.isErr()) throw provisionResult.error;
      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: `provision-database: stack ${provisionResult.value.stackName} deployed`,
        });
      }
      return provisionResult.value;
    });

    // Persist credentials as resource-scoped environment variables
    await step.run("persist-env-vars", async () => {
      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "persist-env-vars: writing generated database credentials",
        });
      }
      const row = await db.query.resource.findFirst({
        where: eq(resource.id, resourceId),
        with: { databaseConfig: true },
      });
      if (!row?.databaseConfig) {
        throw new Error(`No database config found for resource ${resourceId}`);
      }

      const dbType = row.databaseConfig.databaseType;
      const config = DATABASE_CONFIGS[dbType];
      const systemAudit = {
        userId: null,
        actorType: "system" as const,
        actorLabel: "otterstack/database-provision",
        ipAddress: null,
        userAgent: "otterstack/database-provision",
      };

      // Write each credential as an env var (e.g. POSTGRES_USER, POSTGRES_PASSWORD, etc.)
      for (const [credKey, envVarName] of Object.entries(config.envMapping)) {
        const value = result.credentials[credKey];
        if (!value) continue;

        const upsertResult = await upsertEnvironmentVariable({
          organizationId: orgId,
          projectId: event.data.projectId,
          environmentId: event.data.environmentId,
          resourceId,
          scope: "resource",
          key: envVarName,
          value,
          isSecret: credKey === "password" || credKey === "rootPassword",
          buildTime: false,
          audit: systemAudit,
        });

        if (upsertResult.isErr()) {
          logger.error(
            { resourceId, key: envVarName, err: upsertResult.error },
            "Failed to persist env var",
          );
          throw upsertResult.error;
        }
      }

      // Write the connection string as DATABASE_URL
      const connStringResult = await upsertEnvironmentVariable({
        organizationId: orgId,
        projectId: event.data.projectId,
        environmentId: event.data.environmentId,
        resourceId,
        scope: "resource",
        key: "DATABASE_URL",
        value: result.connectionString,
        isSecret: true,
        buildTime: false,
        audit: systemAudit,
      });

      if (connStringResult.isErr()) {
        logger.error(
          { resourceId, err: connStringResult.error },
          "Failed to persist DATABASE_URL",
        );
        throw connStringResult.error;
      }

      // Update databaseConfig with the generated credentials
      await db
        .update(databaseConfig)
        .set({
          databaseName: result.credentials.database || null,
          databaseUser: result.credentials.user || null,
          updatedAt: new Date(),
        })
        .where(eq(databaseConfig.resourceId, resourceId));

      logger.info(
        { resourceId, envVarCount: Object.keys(config.envMapping).length + 1 },
        "Database credentials persisted as env vars",
      );
      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "persist-env-vars: completed",
        });
      }
    });

    // Mark resource as online
    await step.run("update-resource-status", async () => {
      await db
        .update(resource)
        .set({ status: "online", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));

      if (deploymentId) {
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "update-resource-status: marking deployment live",
        });
        await safeTransition(deploymentId, "verifying", "Verifying database health");
        await safeTransition(deploymentId, "live", "Database provision completed");
        await deploymentLogService.appendDeploymentLog({
          deploymentId,
          tab: "deploy",
          message: "database provisioning completed successfully",
        });
      }
    });

    logger.info({ resourceId, result }, "Database provisioned successfully");
    return result;
  },
);
