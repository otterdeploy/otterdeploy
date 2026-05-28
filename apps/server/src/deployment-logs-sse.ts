/**
 * Route wiring for the deployment-logs SSE endpoint. Handler logic lives
 * in `./handlers/deployment-logs-sse`; this file is the GET signature +
 * the middleware chain (param validation → cookie session).
 */

import type { Hono as HonoApp } from "hono";
import * as z from "zod";

import { type EvlogVariables } from "evlog/hono";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { deploymentLogsSseHandler } from "./handlers";
import { requireSseSession } from "./lib/sse-auth";
import { validateParams } from "./lib/validate";

const paramsSchema = z.object({ deploymentId: zId(ID_PREFIX.deployment) });

export function registerDeploymentLogsSseRoutes(app: HonoApp<EvlogVariables>): void {
  app.get(
    "/sse/deployments/:deploymentId/logs",
    validateParams(paramsSchema),
    requireSseSession,
    deploymentLogsSseHandler,
  );
}
