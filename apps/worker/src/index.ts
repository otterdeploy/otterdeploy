import { Hono } from "hono";
import { serve } from "inngest/hono";
import { createLogger } from "@otterdeploy/logger";

import { inngest } from "./inngest";
import { functions } from "./functions";

const logger = createLogger("worker");

const app = new Hono();

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({ client: inngest, functions }),
);

app.get("/", (c) => c.text("Worker OK"));

logger.info("Inngest worker started");

export default app;
