import { db, sql } from "@otterdeploy/db";
import { Result } from "better-result";

export async function getHealth() {
  return {
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  };
}

export async function getReadiness() {
  const dbPing = await Result.tryPromise({
    try: () => db.execute(sql`SELECT 1`),
    catch: () => "down" as const,
  });
  const dbStatus: "ok" | "degraded" | "down" = dbPing.isOk() ? "ok" : "down";

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
