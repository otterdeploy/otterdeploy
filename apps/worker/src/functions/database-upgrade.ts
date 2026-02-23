import { createLogger } from "@otterdeploy/logger";
import { inngest } from "../inngest";

const logger = createLogger("database-upgrade");

export const databaseUpgrade = inngest.createFunction(
  {
    id: "database-upgrade",
    retries: 1,
  },
  { event: "resource.updated" },
  async ({ event, step }) => {
    const { resourceId } = event.data;

    // Check if this is a version upgrade by inspecting metadata
    // This is a simplified version -- full impl would check if imageTag changed

    await step.run("upgrade-database", async () => {
      // The actual new image tag and db type would come from the event metadata
      // For now this shows the structure
      logger.info({ resourceId }, "Database upgrade triggered");
    });
  },
);
