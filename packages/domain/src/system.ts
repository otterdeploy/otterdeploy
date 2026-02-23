import { db, sql } from "@otterdeploy/db";
import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("domain:system");

export interface SystemHealth {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  checks: {
    database: { status: "ok" | "degraded" | "down"; latencyMs?: number };
    docker: { status: "ok" | "down"; version?: string; swarm?: string };
    caddy: { status: "ok" | "down"; adminApi?: boolean };
  };
}

export async function getHealth(): Promise<SystemHealth> {
  const timestamp = new Date().toISOString();
  const checks: SystemHealth["checks"] = {
    database: { status: "down" },
    docker: { status: "down" },
    caddy: { status: "down" },
  };

  // Check database
  const dbStart = Date.now();
  const dbPing = await Result.tryPromise({
    try: () => db.execute(sql`SELECT 1`),
    catch: () => "down" as const,
  });
  if (dbPing.isOk()) {
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  }

  // Docker and Caddy checks are async and may fail — wrap in try/catch
  try {
    const { execSync } = await import("node:child_process");
    const dockerVersion = execSync("docker --version", { encoding: "utf-8", timeout: 3000 }).trim();
    const versionMatch = dockerVersion.match(/Docker version ([\d.]+)/);

    let swarmStatus = "inactive";
    try {
      const info = execSync("docker info --format '{{.Swarm.LocalNodeState}}'", {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      swarmStatus = info;
    } catch { /* swarm check failed */ }

    checks.docker = {
      status: "ok",
      version: versionMatch ? versionMatch[1] : undefined,
      swarm: swarmStatus,
    };
  } catch {
    checks.docker = { status: "down" };
  }

  // Check Caddy Admin API
  try {
    const response = await fetch("http://127.0.0.1:2019/config/", {
      signal: AbortSignal.timeout(3000),
    });
    checks.caddy = { status: response.ok ? "ok" : "down", adminApi: response.ok };
  } catch {
    checks.caddy = { status: "down", adminApi: false };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const anyDown = Object.values(checks).some((c) => c.status === "down");
  const status = allOk ? "ok" : anyDown ? "degraded" : "ok";

  return { status, timestamp, checks };
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
    },
  };
}

export async function getVersion() {
  return {
    version: "0.1.0",
    commit: process.env.GIT_COMMIT ?? null,
    builtAt: process.env.BUILD_TIME ?? null,
  };
}
