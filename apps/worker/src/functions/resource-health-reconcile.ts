import { createLogger } from "@otterdeploy/logger";
import { reconcileResourceHealth } from "../services/resource-health-watcher";
import { inngest } from "../inngest";

const logger = createLogger("resource-health-reconcile");

export const resourceHealthReconcile = inngest.createFunction(
  {
    id: "resource-health-reconcile",
    retries: 1,
  },
  { cron: "* * * * *" }, // Every minute
  async ({ step }) => {
    await step.run("reconcile-resource-health", async () => {
      logger.debug("Running periodic resource health reconciliation");
      await reconcileResourceHealth();
    });
  },
);
