/**
 * Route wiring for the project-events SSE endpoint. Handler logic lives
 * in `./handlers/project-events-sse`; this file is the GET signature +
 * the middleware chain (param validation → cookie session).
 */

import type { Hono as HonoApp } from "hono";
import * as z from "zod";

import { type EvlogVariables } from "evlog/hono";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { projectEventsSseHandler } from "./handlers";
import { requireSseSession } from "./lib/sse-auth";
import { validateParams } from "./lib/validate";

const paramsSchema = z.object({ projectId: zId(ID_PREFIX.project) });

export function registerEventsSseRoutes(app: HonoApp<EvlogVariables>): void {
  app.get(
    "/sse/projects/:projectId/events",
    validateParams(paramsSchema),
    requireSseSession,
    projectEventsSseHandler,
  );
}
