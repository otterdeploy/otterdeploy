import { describe, expect, it } from "vitest";
import { isContractProcedure } from "@orpc/contract";

import { appContract } from "../app";
import {
  BuildMethodSchema,
  DeploymentSourceSchema,
  DeploymentStatusSchema,
  EnvVarScopeSchema,
  ErrorCodeSchema,
  OrgRoleSchema,
  ResourceKindSchema,
  ResourceStatusSchema,
} from "../shared";

// ---- Router structure ----

const REQUIRED_ROUTERS = [
  "project",
  "environment",
  "resource",
  "resourceLink",
  "architecture",
  "deployment",
  "environmentVariable",
  "gitProvider",
  "domain",
  "server",
  "monitoring",
  "backup",
  "team",
  "audit",
  "system",
] as const;

describe("Contract structure", () => {
  it("exports appContract with all 15 required routers", () => {
    const routers = Object.keys(appContract).sort();
    for (const name of REQUIRED_ROUTERS) {
      expect(routers, `missing router: ${name}`).toContain(name);
    }
    expect(routers).toHaveLength(REQUIRED_ROUTERS.length);
  });

  it("has exactly 58 procedures", () => {
    let count = 0;
    function walk(obj: unknown) {
      if (!obj || typeof obj !== "object") return;
      for (const value of Object.values(obj)) {
        if (isContractProcedure(value)) {
          count++;
        } else {
          walk(value);
        }
      }
    }
    walk(appContract);
    expect(count).toBe(58);
  });

  it("every procedure has input and output schemas", () => {
    function walk(obj: unknown, path: string[] = []) {
      if (!obj || typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj)) {
        const nextPath = [...path, key];
        if (isContractProcedure(value)) {
          const meta = (value as { "~orpc"?: { inputSchema?: unknown; outputSchema?: unknown } })[
            "~orpc"
          ];
          expect(meta?.inputSchema, `${nextPath.join(".")} missing input`).toBeDefined();
          expect(meta?.outputSchema, `${nextPath.join(".")} missing output`).toBeDefined();
        } else {
          walk(value, nextPath);
        }
      }
    }
    walk(appContract);
  });

  it("every procedure has an HTTP method and path", () => {
    function walk(obj: unknown, path: string[] = []) {
      if (!obj || typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj)) {
        const nextPath = [...path, key];
        if (isContractProcedure(value)) {
          const meta = (value as { "~orpc"?: { route?: { method?: string; path?: string } } })[
            "~orpc"
          ];
          expect(meta?.route?.method, `${nextPath.join(".")} missing method`).toBeDefined();
          expect(meta?.route?.path, `${nextPath.join(".")} missing path`).toBeDefined();
        } else {
          walk(value, nextPath);
        }
      }
    }
    walk(appContract);
  });
});

// ---- Procedure inventory per router ----

describe("Router procedures", () => {
  it("project has create, getById, list, update, delete", () => {
    expect(Object.keys(appContract.project).sort()).toEqual([
      "create",
      "delete",
      "getById",
      "list",
      "update",
    ]);
  });

  it("environment has create, getById, list, delete", () => {
    expect(Object.keys(appContract.environment).sort()).toEqual([
      "create",
      "delete",
      "getById",
      "list",
    ]);
  });

  it("resource has create, getById, list, update, delete", () => {
    expect(Object.keys(appContract.resource).sort()).toEqual([
      "create",
      "delete",
      "getById",
      "list",
      "update",
    ]);
  });

  it("deployment has create, getById, list, cancel, rollback, streamLogs", () => {
    expect(Object.keys(appContract.deployment).sort()).toEqual([
      "cancel",
      "create",
      "getById",
      "list",
      "rollback",
      "streamLogs",
    ]);
  });

  it("system has health, ready, version (public endpoints)", () => {
    expect(Object.keys(appContract.system).sort()).toEqual(["health", "ready", "version"]);
  });
});

// ---- Shared schema validation ----

describe("Shared schemas", () => {
  it("ResourceKindSchema accepts all 6 kinds", () => {
    const kinds = ["web", "api", "worker", "database", "cache", "volume"];
    for (const kind of kinds) {
      expect(ResourceKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("ResourceStatusSchema includes deploying and stopped", () => {
    expect(ResourceStatusSchema.safeParse("deploying").success).toBe(true);
    expect(ResourceStatusSchema.safeParse("stopped").success).toBe(true);
    expect(ResourceStatusSchema.safeParse("online").success).toBe(true);
  });

  it("DeploymentStatusSchema has all 8 states", () => {
    const states = [
      "queued",
      "building",
      "deploying",
      "verifying",
      "live",
      "failed",
      "canceled",
      "rolled_back",
    ];
    for (const state of states) {
      expect(DeploymentStatusSchema.safeParse(state).success, `missing: ${state}`).toBe(true);
    }
  });

  it("DeploymentSourceSchema has all 5 sources", () => {
    const sources = ["git_push", "manual", "rollback", "api", "preview"];
    for (const source of sources) {
      expect(DeploymentSourceSchema.safeParse(source).success, `missing: ${source}`).toBe(true);
    }
  });

  it("BuildMethodSchema has all 3 methods", () => {
    const methods = ["nixpacks", "dockerfile", "buildpack"];
    for (const method of methods) {
      expect(BuildMethodSchema.safeParse(method).success, `missing: ${method}`).toBe(true);
    }
  });

  it("OrgRoleSchema has 4 roles in hierarchy order", () => {
    const roles = ["owner", "admin", "member", "viewer"];
    for (const role of roles) {
      expect(OrgRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("EnvVarScopeSchema has 3 scopes", () => {
    const scopes = ["project", "environment", "resource"];
    for (const scope of scopes) {
      expect(EnvVarScopeSchema.safeParse(scope).success).toBe(true);
    }
  });

  it("ErrorCodeSchema has all 7 error codes", () => {
    const codes = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "BAD_REQUEST",
      "TOO_MANY_REQUESTS",
      "INTERNAL",
    ];
    for (const code of codes) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(ResourceKindSchema.safeParse("invalid").success).toBe(false);
    expect(DeploymentStatusSchema.safeParse("running").success).toBe(false);
    expect(OrgRoleSchema.safeParse("superadmin").success).toBe(false);
  });
});
