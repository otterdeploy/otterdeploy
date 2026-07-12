import { describe, expect, it } from "vite-plus/test";

import type { Port } from "./form-fields/ports-field";
import type { Var } from "./form-fields/variables-field";

import {
  buildDatabaseSpec,
  buildServiceSpec,
  buildFromBuilderId,
  envFromVars,
  healthcheckFromForm,
  portsToManifest,
  resourcesFromForm,
} from "./to-manifest";

const port = (over: Partial<Port> = {}): Port => ({
  port: 3000,
  protocol: "http",
  public: true,
  host: "",
  ...over,
});
const v = (over: Partial<Var> = {}): Var => ({
  key: "FOO",
  value: "bar",
  secret: false,
  ...over,
});

describe("envFromVars", () => {
  it("keeps UPPER_SNAKE keys and drops invalid ones", () => {
    expect(envFromVars([v({ key: "API_URL", value: "x" }), v({ key: "bad-key" })])).toEqual({
      API_URL: "x",
    });
  });

  it("uses ${secret} only for a secret row with no value", () => {
    expect(
      envFromVars([
        v({ key: "TOKEN", value: "", secret: true }),
        v({ key: "PASSWORD", value: "hunter2", secret: true }),
      ]),
    ).toEqual({ TOKEN: "${secret}", PASSWORD: "hunter2" });
  });

  it("returns undefined when nothing valid remains", () => {
    expect(envFromVars([])).toBeUndefined();
    expect(envFromVars([v({ key: "lower" })])).toBeUndefined();
  });
});

describe("resourcesFromForm", () => {
  it("maps a known preset to cpu/memory", () => {
    expect(resourcesFromForm("small", 0, 0)).toEqual({ cpuLimit: 0.5, memoryMb: 512 });
  });
  it("uses the custom sliders for the custom preset", () => {
    expect(resourcesFromForm("custom", 2, 4096)).toEqual({ cpuLimit: 2, memoryMb: 4096 });
  });
  it("returns undefined for an unknown preset", () => {
    expect(resourcesFromForm("nope", 0, 0)).toBeUndefined();
  });
});

describe("portsToManifest", () => {
  it("marks the first port primary and classifies app protocol", () => {
    expect(
      portsToManifest([
        port({ port: 8080, protocol: "http" }),
        port({ port: 5432, protocol: "tcp" }),
      ]),
    ).toEqual([
      { container: 8080, protocol: "tcp", appProtocol: "http", primary: true },
      { container: 5432, protocol: "tcp", appProtocol: "tcp", primary: false },
    ]);
  });
  it("maps udp through and drops invalid ports", () => {
    expect(portsToManifest([port({ port: 0 }), port({ port: 53, protocol: "udp" })])).toEqual([
      { container: 53, protocol: "udp", appProtocol: "tcp", primary: true },
    ]);
  });
});

describe("buildFromBuilderId", () => {
  it("maps wizard builder ids to manifest discriminants", () => {
    expect(buildFromBuilderId("railpack")).toEqual({ builder: "railpack" });
    expect(buildFromBuilderId("dockerfile")).toEqual({ builder: "dockerfile" });
    expect(buildFromBuilderId("compose")).toEqual({ builder: "compose" });
  });
  it("falls back to auto for builders with no manifest variant", () => {
    expect(buildFromBuilderId("buildpack")).toEqual({ builder: "auto" });
    expect(buildFromBuilderId("static")).toEqual({ builder: "auto" });
    expect(buildFromBuilderId("nixpack")).toEqual({ builder: "auto" });
    expect(buildFromBuilderId("anything")).toEqual({ builder: "auto" });
  });
});

describe("healthcheckFromForm", () => {
  const ports = [{ container: 8080, primary: true }, { container: 9090 }];

  it("builds the portable wget||curl probe against the primary port", () => {
    const hc = healthcheckFromForm({
      path: "/healthz",
      intervalSec: 10,
      timeoutSec: 3,
      retries: 3,
      ports,
    });
    expect(hc).toEqual({
      cmd: [
        "CMD-SHELL",
        'wget -q -O /dev/null "http://127.0.0.1:8080/healthz" || curl -fsS -o /dev/null "http://127.0.0.1:8080/healthz"',
      ],
      intervalMs: 10_000,
      timeoutMs: 3_000,
      retries: 3,
    });
  });

  it("normalizes a missing leading slash", () => {
    const hc = healthcheckFromForm({
      path: "status",
      intervalSec: 5,
      timeoutSec: 2,
      retries: 1,
      ports,
    });
    expect(hc?.cmd[1]).toContain("http://127.0.0.1:8080/status");
  });

  it("returns undefined for an empty path (opt-in probe) or no ports", () => {
    expect(
      healthcheckFromForm({ path: "", intervalSec: 10, timeoutSec: 3, retries: 3, ports }),
    ).toBeUndefined();
    expect(
      healthcheckFromForm({ path: "  ", intervalSec: 10, timeoutSec: 3, retries: 3, ports }),
    ).toBeUndefined();
    expect(
      healthcheckFromForm({
        path: "/healthz",
        intervalSec: 10,
        timeoutSec: 3,
        retries: 3,
        ports: [],
      }),
    ).toBeUndefined();
  });

  it("refuses shell-active characters instead of emitting a broken probe", () => {
    expect(
      healthcheckFromForm({
        path: '/x"; rm -rf /',
        intervalSec: 10,
        timeoutSec: 3,
        retries: 3,
        ports,
      }),
    ).toBeUndefined();
  });
});

describe("buildServiceSpec", () => {
  const base = {
    kindId: "app",
    ports: [port()],
    variables: [v({ key: "API_URL", value: "x" })],
    replicas: 3,
    presetId: "small",
    customCpu: 0,
    customMem: 0,
    builderId: "dockerfile",
    spa: true,
    // Health check off by default ("" = no probe).
    healthPath: "",
    healthInterval: 10,
    healthTimeout: 3,
    healthRetries: 3,
    root: "apps/web",
  };

  it("assembles a git spec with build, subdir, env, replicas, resources", () => {
    const spec = buildServiceSpec({ ...base, source: "git", image: "pending:initial" });
    expect(spec).toEqual({
      source: "git",
      sourceSubdir: "apps/web",
      build: { builder: "dockerfile" },
      ports: [{ container: 3000, protocol: "tcp", appProtocol: "http", primary: true }],
      env: { API_URL: "x" },
      replicas: 3,
      resources: { cpuLimit: 0.5, memoryMb: 512 },
    });
  });

  it("emits the bound repo + branch so apply binds the git_repo (no unbound service)", () => {
    const spec = buildServiceSpec({
      ...base,
      source: "git",
      image: "pending:initial",
      repo: "artzkaizen/dealort",
      branch: "main",
    });
    expect(spec).toMatchObject({ source: "git", repo: "artzkaizen/dealort", branch: "main" });
  });

  it("omits repo/branch when the git service is left unbound", () => {
    const spec = buildServiceSpec({ ...base, source: "git", image: "pending:initial" });
    expect(spec).not.toHaveProperty("repo");
    expect(spec).not.toHaveProperty("branch");
  });

  it("forces railpack + spa for the static kind, ignoring the picked builder", () => {
    const spec = buildServiceSpec({
      ...base,
      kindId: "static",
      source: "git",
      image: "pending:initial",
      builderId: "dockerfile",
      spa: true,
    });
    expect(spec).toMatchObject({
      source: "git",
      build: { builder: "railpack", spa: true, staticRoot: "dist" },
      ports: [{ container: 80, protocol: "tcp", appProtocol: "http", primary: true }],
    });
  });

  it("omits spa from the static build when the toggle is off", () => {
    const spec = buildServiceSpec({
      ...base,
      kindId: "static",
      source: "git",
      image: "pending:initial",
      spa: false,
    });
    expect(spec).toMatchObject({ source: "git" });
    const build = (spec as { build?: Record<string, unknown> }).build;
    expect(build).toEqual({ builder: "railpack", staticRoot: "dist" });
  });

  it("emits the manifest healthcheck when a path is set — and never for static kinds", () => {
    const spec = buildServiceSpec({
      ...base,
      source: "git",
      image: "pending:initial",
      healthPath: "/healthz",
    });
    expect(spec).toMatchObject({
      healthcheck: { intervalMs: 10_000, timeoutMs: 3_000, retries: 3 },
    });
    const staticSpec = buildServiceSpec({
      ...base,
      kindId: "static",
      source: "git",
      image: "pending:initial",
      healthPath: "/healthz",
    });
    expect(staticSpec).not.toHaveProperty("healthcheck");
  });

  it("assembles an image spec and omits git-only fields", () => {
    const spec = buildServiceSpec({
      ...base,
      source: "image",
      image: "nginx:latest",
      replicas: 1,
      root: "",
    });
    expect(spec).toMatchObject({ source: "image", image: "nginx:latest" });
    expect(spec).not.toHaveProperty("build");
    expect(spec).not.toHaveProperty("sourceSubdir");
    // replicas omitted when 1 (server default)
    expect(spec).not.toHaveProperty("replicas");
  });
});

describe("buildDatabaseSpec", () => {
  it("keeps extensions for postgres and applies version + sizing", () => {
    expect(
      buildDatabaseSpec({
        engine: "postgres",
        publicEnabled: true,
        extensions: ["uuid-ossp"],
        version: "18",
        presetId: "small",
        customCpu: 0,
        customMem: 0,
      }),
    ).toEqual({
      engine: "postgres",
      publicEnabled: true,
      resources: { cpuLimit: 0.5, memoryMb: 512 },
      version: "18",
      extensions: ["uuid-ossp"],
    });
  });

  it("omits extensions for non-postgres engines", () => {
    const spec = buildDatabaseSpec({
      engine: "redis",
      publicEnabled: false,
      extensions: ["should-be-ignored"],
      version: "7.4",
      presetId: "nope",
      customCpu: 0,
      customMem: 0,
    });
    expect(spec).toEqual({ engine: "redis", version: "7.4" });
    expect(spec).not.toHaveProperty("extensions");
  });

  it("emits no storage/backup/HA fields — the manifest and provisioner don't support them", () => {
    // Regression guard for the storage-step honesty cleanup: if someone
    // reintroduces wizard storage controls, they must land as real manifest
    // fields the reconciler honors, not silently-dropped keys.
    const spec = buildDatabaseSpec({
      engine: "postgres",
      publicEnabled: false,
      extensions: [],
      version: "18",
      presetId: "small",
      customCpu: 0,
      customMem: 0,
    });
    for (const key of [
      "storageGb",
      "autoGrow",
      "encrypted",
      "backupsEnabled",
      "backupRetention",
      "backupWindow",
      "pitr",
      "highAvailability",
    ]) {
      expect(spec).not.toHaveProperty(key);
    }
  });
});
