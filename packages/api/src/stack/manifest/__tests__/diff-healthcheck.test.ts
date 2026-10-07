/**
 * A healthcheck declared on an EXISTING service must reach it: before it was
 * diffed, apply never wrote it and the container ran with no Health config
 * even though its manifest declared one. Declared-only, like every other
 * service field.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { CurrentHealthcheck, CurrentService, CurrentState } from "../diff";

import { buildUpdateServiceInput } from "../../../routers/project/manifest-apply-services";
import { diffManifest } from "../diff";
import { manifestSchema } from "../schema";

const NEVER_HEALTHY = {
  cmd: ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1))"],
  intervalMs: 5000,
  timeoutMs: 3000,
  retries: 3,
  startMs: 10_000,
};

function current(healthcheck: CurrentHealthcheck | null | undefined): CurrentState {
  const web: CurrentService = {
    name: "web",
    source: "upload",
    image: "otterdeploy-local/web:dep_1",
    sourceSubdir: null,
    repo: null,
    branch: null,
    imageRepository: null,
    replicas: 1,
    command: null,
    entrypoint: null,
    ports: [{ containerPort: 3000, protocol: "tcp", appProtocol: "http", isPrimary: true }],
    env: {},
    publicEnabled: false,
    previewsEnabled: false,
    preDeploy: null,
    postDeploy: null,
    buildConfig: null,
    restartCondition: "on-failure",
    restartMaxAttempts: null,
    restartDelayMs: 5000,
    restartWindowMs: null,
    cpuLimit: null,
    memoryLimitMb: null,
    cpuReservation: null,
    memoryReservationMb: null,
    diskLimitMb: null,
    swapLimitMb: null,
    pidsLimit: null,
    ...(healthcheck === undefined ? {} : { healthcheck }),
  };
  return { services: { web }, databases: {}, composes: {} };
}

function desired(healthcheck: unknown) {
  return manifestSchema.parse({
    project: "acme-never-healthy",
    services: {
      web: {
        source: "upload",
        ports: [{ container: 3000, appProtocol: "http", primary: true }],
        ...(healthcheck === undefined ? {} : { healthcheck }),
      },
    },
  });
}

describe("healthcheck diff", () => {
  it("a healthcheck added to a service that had none is an update", () => {
    const changes = diffManifest(desired(NEVER_HEALTHY), current(null));
    expect(changes).toEqual([
      {
        kind: "update",
        resource: "service",
        name: "web",
        details: {
          fields: {
            healthcheck: { from: null, to: NEVER_HEALTHY },
          },
        },
      },
    ]);
  });

  it("the same healthcheck is a no-op; omitted timings compare as null", () => {
    expect(diffManifest(desired(NEVER_HEALTHY), current(NEVER_HEALTHY))).toEqual([
      { kind: "no-op", resource: "service", name: "web" },
    ]);
    const bare = { cmd: ["true"] };
    const stored = {
      cmd: ["true"],
      intervalMs: null,
      timeoutMs: null,
      retries: null,
      startMs: null,
    };
    expect(diffManifest(desired(bare), current(stored))[0]?.kind).toBe("no-op");
  });

  it("a changed command or timing is an update", () => {
    const changed = diffManifest(desired({ ...NEVER_HEALTHY, retries: 5 }), current(NEVER_HEALTHY));
    expect(changed[0]?.kind).toBe("update");
  });

  it("omitted is live-managed: no diff whatever the row holds", () => {
    expect(diffManifest(desired(undefined), current(NEVER_HEALTHY))[0]?.kind).toBe("no-op");
    // A caller that never loaded the healthcheck reads as "none set".
    expect(diffManifest(desired(undefined), current(undefined))[0]?.kind).toBe("no-op");
  });

  it("null declares none: a stored one is removed, and the apply clears it", () => {
    const changes = diffManifest(desired(null), current(NEVER_HEALTHY));
    expect(changes[0]).toMatchObject({
      kind: "update",
      details: { fields: { healthcheck: { from: NEVER_HEALTHY, to: null } } },
    });
    expect(diffManifest(desired(null), current(null))[0]?.kind).toBe("no-op");
  });
});

// The builder under test threads `log` but never calls it.
const noopLog: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

describe("healthcheck apply patch", () => {
  const args = (healthcheck: unknown) => {
    const spec = desired(healthcheck).services?.web;
    if (!spec) throw new Error("no web");
    return buildUpdateServiceInput(
      {
        projectId: idSchema.project.parse("prj_1"),
        organizationId: idSchema.organization.parse("org_1"),
        resourceId: idSchema.resource.parse("res_1"),
        name: "web",
        spec,
        env: [],
        log: noopLog,
      },
      null,
    );
  };

  it("writes a declared healthcheck with null for omitted timings", () => {
    expect(args({ cmd: ["true"] }).healthcheck).toEqual({
      cmd: ["true"],
      intervalMs: null,
      timeoutMs: null,
      retries: null,
      startMs: null,
    });
  });

  it("clears the stored healthcheck for an explicit null, leaves it for an omission", () => {
    expect(args(null).healthcheck).toEqual({
      cmd: null,
      intervalMs: null,
      timeoutMs: null,
      retries: null,
      startMs: null,
    });
    expect(args(undefined).healthcheck).toBeUndefined();
  });
});
