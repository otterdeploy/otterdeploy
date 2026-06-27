import { describe, expect, it } from "vitest";

import type { Port } from "./form-fields/ports-field";
import type { Var } from "./form-fields/variables-field";

import {
  buildDatabaseSpec,
  buildServiceSpec,
  buildFromBuilderId,
  envFromVars,
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
      build: { builder: "railpack", spa: true, staticRoot: "apps/web/dist" },
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
    expect(build).toEqual({ builder: "railpack", staticRoot: "apps/web/dist" });
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
});
