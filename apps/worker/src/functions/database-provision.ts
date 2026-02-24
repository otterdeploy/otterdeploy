import { createLogger } from "@otterdeploy/logger";
import { provisionDatabase } from "@otterdeploy/domain/database-provisioner";
import {
  stackDeploy,
  stackRemove,
  stackServices,
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
  },
  { event: "resource.created" },
  async ({ event, step }) => {
    const { resourceId, kind, orgId } = event.data;

    // Only handle database resources
    if (kind !== "database") {
      return { skipped: true, reason: "Not a database resource" };
    }

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

    logger.info({ resourceId, result }, "Database provisioned successfully");
    return result;
  },
);
