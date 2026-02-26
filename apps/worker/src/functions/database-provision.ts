import { createLogger } from "@otterdeploy/logger";
import { provisionDatabase } from "@otterdeploy/domain/database-provisioner";
import {
  stackDeploy,
  stackRemove,
  stackServices,
  createProjectNetwork,
} from "@otterdeploy/docker";
import { db, eq } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { inngest } from "../inngest";

const logger = createLogger("database-provision");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const databaseProvision = inngest.createFunction(
  {
    id: "database-provision",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const resourceId = event.data.event.data.resourceId;
      logger.error({ resourceId, err: error }, "Database provisioning failed");

      await db
        .update(resource)
        .set({ status: "crashed", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));
    },
  },
  { event: "resource.created" },
  async ({ event, step }) => {
    const { resourceId, kind, orgId } = event.data;

    // Only handle database resources
    if (kind !== "database") {
      return { skipped: true, reason: "Not a database resource" };
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

    // Mark resource as online
    await step.run("update-resource-status", async () => {
      await db
        .update(resource)
        .set({ status: "online", updatedAt: new Date() })
        .where(eq(resource.id, resourceId));
    });

    logger.info({ resourceId, result }, "Database provisioned successfully");
    return result;
  },
);
