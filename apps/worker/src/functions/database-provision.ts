import { createLogger } from "@otterdeploy/logger";
import { provisionDatabase } from "@otterdeploy/domain/database-provisioner";
import {
  stackDeploy,
  stackRemove,
  stackServices,
} from "@otterdeploy/docker";
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

    // Only handle database/cache resources
    if (kind !== "database" && kind !== "cache") {
      return { skipped: true, reason: "Not a database resource" };
    }

    const result = await step.run("provision-database", async () => {
      const deps = {
        stackDeploy,
        stackRemove,
        stackServices,
        sleep,
      };

      const dbType =
        kind === "cache" ? ("redis" as const) : ("postgresql" as const);

      const provisionResult = await provisionDatabase(
        {
          resourceId,
          projectId: event.data.projectId,
          environmentId: event.data.environmentId,
          organizationId: orgId,
          dbType,
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
