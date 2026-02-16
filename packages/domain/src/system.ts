import { db, sql } from "@otterstack/db";

export async function getHealth() {
  return {
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  };
}

export async function getReadiness() {
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
}

export async function getVersion() {
  return {
    version: "0.1.0",
    commit: null,
    builtAt: null,
  };
}
