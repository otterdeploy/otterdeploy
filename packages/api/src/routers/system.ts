import { db, sql } from "@otterstack/db";

import { publicProcedure } from "../index";

export const systemRouter = {
  health: publicProcedure.handler(async () => {
    return {
      status: "ok" as const,
      timestamp: new Date().toISOString(),
    };
  }),
  ready: publicProcedure.handler(async () => {
    let dbStatus: "ok" | "degraded" | "down" = "down";
    try {
      await db.execute(sql`SELECT 1`);
      dbStatus = "ok";
    } catch {
      dbStatus = "down";
    }

    return {
      status: dbStatus === "ok" ? ("ready" as const) : ("degraded" as const),
      checks: {
        database: dbStatus,
        redis: "down" as const,
      },
    };
  }),
  version: publicProcedure.handler(async () => {
    return {
      version: "0.1.0",
      commit: null,
      builtAt: null,
    };
  }),
};
