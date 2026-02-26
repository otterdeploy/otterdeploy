import { createLogger } from "@otterdeploy/logger";
import { ConflictError, deploymentMachine } from "@otterdeploy/domain";
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
    // Retries can race with prior attempts; ignore invalid transition conflicts.
    if (transitionResult.error instanceof ConflictError) return;
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
          if (!(transitionResult.error instanceof ConflictError)) {
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
      await safeTransition(deploymentId, "building", "Database provision started");
      await safeTransition(deploymentId, "deploying", "Deploying database service");
    }

    // Ensure the project network exists before deploying the stack
    await step.run("ensure-network", async () => {
      const networkResult = await createProjectNetwork(event.data.projectId);
      if (networkResult.isErr()) throw networkResult.error;
    });

    const result = await step.run("provision-database", async () => {
      const row = await db.query.resource.findFirst({
        where: eq(resource.id, resourceId),
        with: { databaseConfig: true },
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
          organizationId: orgId,
          dbType: row.databaseConfig.databaseType,
        },
        deps,
      );

      if (provisionResult.isErr()) throw provisionResult.error;
      return provisionResult.value;
    });

    // Persist credentials as resource-scoped environment variables
    await step.run("persist-env-vars", async () => {
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
    });

    // Mark resource as online
    await step.run("update-resource-status", async () => {
      await db
        .update(resource)
        .set({ status: "online", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));

      if (deploymentId) {
        await safeTransition(deploymentId, "verifying", "Verifying database health");
        await safeTransition(deploymentId, "live", "Database provision completed");
      }
    });

    logger.info({ resourceId, result }, "Database provisioned successfully");
    return result;
  },
);
