/**
 * Web-analytics public routes (`/a/*`, docs/designs/web-analytics.md §3–4).
 * Registered by apps/server/src/index.ts ABOVE the evlog middleware and the
 * credentialed CORS: this is the tracker's hot path (third-party pages,
 * `sendBeacon`), so it gets permissive anonymous CORS, no per-request wide
 * event, and the 64 KB `/a/` body-limit rule.
 */

import type { EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";

import { COLLECT_PATH, TRACKER_PATH } from "@otterdeploy/api/analytics/tracker";
import { cors } from "hono/cors";

import { handleCollectRequest } from "./collect";
import { handleTrackerScript } from "./tracker";

export function registerAnalyticsRoutes(app: Hono<EvlogVariables>): void {
  app.use(
    "/a/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 86400,
    }),
  );
  app.post(COLLECT_PATH, handleCollectRequest);
  app.get(TRACKER_PATH, handleTrackerScript);
}
