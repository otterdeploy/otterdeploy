import { Hono } from "hono";
import { serve } from "inngest/hono";
import { createLogger } from "@otterdeploy/logger";

import { inngest } from "./inngest";
import { functions } from "./functions";
import { startResourceHealthWatcher } from "./services/resource-health-watcher";

const logger = createLogger("worker");

const app = new Hono();

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({ client: inngest, functions }),
);

app.get("/", (c) => c.text("Worker OK"));

// Start background Docker event stream listener for resource health monitoring
const healthWatcher = startResourceHealthWatcher();

const shutdown = () => {
  logger.info("Shutting down health watcher...");
  healthWatcher.stop();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("Inngest worker started");

export default app;
