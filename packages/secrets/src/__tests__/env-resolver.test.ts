import { describe, it, expect, vi } from "vitest";
import { resolveEnvVars } from "../env-resolver";
import type { EnvResolverDeps, EnvVarRow } from "../env-resolver";

function makeRow(overrides: Partial<EnvVarRow> & { key: string }): EnvVarRow {
  return {
    id: `var-${overrides.key}`,
    key: overrides.key,
    encryptedValue: `enc-${overrides.key}`,
    secretReferenceId: null,
    scope: "project",
    scopeId: "proj-1",
    isBuildTime: false,
    isSecret: false,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<EnvResolverDeps> = {}): EnvResolverDeps {
  return {
    getProjectVars: vi.fn().mockResolvedValue([]),
    getEnvironmentVars: vi.fn().mockResolvedValue([]),
    getResourceVars: vi.fn().mockResolvedValue([]),
    decryptValue: vi.fn((v: string) => v.replace("enc-", "dec-")),
    ...overrides,
  };
}

describe("resolveEnvVars", () => {
  it("resolves project-scoped variables", async () => {
    const deps = makeDeps({
      getProjectVars: vi.fn().mockResolvedValue([
        makeRow({ key: "DATABASE_URL", scope: "project", scopeId: "proj-1" }),
      ]),
    });

    const result = await resolveEnvVars("res-1", "env-1", "proj-1", deps);

    expect(result.isOk()).toBe(true);
    const vars = result.unwrap();
    expect(vars).toHaveLength(1);
    expect(vars[0].key).toBe("DATABASE_URL");
    expect(vars[0].value).toBe("dec-DATABASE_URL");
    expect(vars[0].scope).toBe("project");
  });

  it("environment vars override project vars with the same key", async () => {
    const deps = makeDeps({
      getProjectVars: vi.fn().mockResolvedValue([
        makeRow({ key: "API_KEY", scope: "project", scopeId: "proj-1" }),
      ]),
      getEnvironmentVars: vi.fn().mockResolvedValue([
        makeRow({
          key: "API_KEY",
          scope: "environment",
          scopeId: "env-1",
          encryptedValue: "enc-env-API_KEY",
        }),
      ]),
    });

    const result = await resolveEnvVars("res-1", "env-1", "proj-1", deps);

    expect(result.isOk()).toBe(true);
    const vars = result.unwrap();
    expect(vars).toHaveLength(1);
    expect(vars[0].scope).toBe("environment");
    expect(vars[0].value).toBe("dec-env-API_KEY");
  });

  it("resource vars override environment vars with the same key", async () => {
    const deps = makeDeps({
      getEnvironmentVars: vi.fn().mockResolvedValue([
        makeRow({ key: "PORT", scope: "environment", scopeId: "env-1" }),
      ]),
      getResourceVars: vi.fn().mockResolvedValue([
        makeRow({
          key: "PORT",
          scope: "resource",
          scopeId: "res-1",
          encryptedValue: "enc-res-PORT",
        }),
      ]),
    });

    const result = await resolveEnvVars("res-1", "env-1", "proj-1", deps);

    expect(result.isOk()).toBe(true);
    const vars = result.unwrap();
    expect(vars).toHaveLength(1);
    expect(vars[0].scope).toBe("resource");
    expect(vars[0].value).toBe("dec-res-PORT");
  });

  it("separates build-time and runtime vars correctly", async () => {
    const deps = makeDeps({
      getProjectVars: vi.fn().mockResolvedValue([
        makeRow({ key: "BUILD_VAR", isBuildTime: true }),
        makeRow({ key: "RUNTIME_VAR", isBuildTime: false }),
      ]),
    });

    const result = await resolveEnvVars("res-1", "env-1", "proj-1", deps);

    expect(result.isOk()).toBe(true);
    const vars = result.unwrap();
    const buildVars = vars.filter((v) => v.isBuildTime);
    const runtimeVars = vars.filter((v) => !v.isBuildTime);
    expect(buildVars).toHaveLength(1);
    expect(buildVars[0].key).toBe("BUILD_VAR");
    expect(runtimeVars).toHaveLength(1);
    expect(runtimeVars[0].key).toBe("RUNTIME_VAR");
  });
});
