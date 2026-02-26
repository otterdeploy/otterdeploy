import { createLogger } from "@otterdeploy/logger";
import { upgradeDatabase } from "@otterdeploy/domain/database-provisioner";
import { db, eq } from "@otterdeploy/db";
import { environment } from "@otterdeploy/db/schema/project";
import {
  stackDeploy,
  stackRemove,
  stackServices,
} from "@otterdeploy/docker";
import { inngest } from "../inngest";

const logger = createLogger("database-upgrade");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const databaseUpgrade = inngest.createFunction(
  {
    id: "database-upgrade",
    retries: 1,
  },
  { event: "resource.updated" },
  async ({ event, step }) => {
    const { resourceId, projectId, environmentId, orgId } = event.data;

    // Upgrade-specific fields are passed in the event metadata
    const meta = event.data as Record<string, unknown>;
    const newImageTag = meta.newImageTag as string | undefined;
    const dbType = meta.dbType as string | undefined;
    const credentials = meta.credentials as Record<string, string> | undefined;
    const externalPort = meta.externalPort as number | undefined;
    const resourceLimits = meta.resourceLimits as
      | { cpuLimit?: number; memoryLimitMb?: number }
      | undefined;

    if (!newImageTag || !dbType || !credentials) {
      return { skipped: true, reason: "Not a database version upgrade" };
    }

    const result = await step.run("upgrade-database", async () => {
      const envRow = await db.query.environment.findFirst({
        where: eq(environment.id, environmentId),
        columns: { id: true, slug: true },
        with: {
          project: {
            columns: { id: true, slug: true },
          },
        },
      });

      const deps = {
        stackDeploy,
        stackRemove,
        stackServices,
        sleep,
      };

      const upgradeResult = await upgradeDatabase(
        {
          resourceId,
          projectId,
          environmentId,
          projectSlug: envRow?.project?.slug ?? projectId,
          environmentSlug: envRow?.slug ?? environmentId,
          organizationId: orgId,
          newImageTag,
          dbType: dbType as "postgresql" | "redis" | "mysql" | "mongodb",
          credentials,
          externalPort,
          resourceLimits,
        },
        deps,
      );

      if (upgradeResult.isErr()) throw upgradeResult.error;
    });

    logger.info({ resourceId, newImageTag }, "Database upgraded successfully");
    return result;
  },
);
