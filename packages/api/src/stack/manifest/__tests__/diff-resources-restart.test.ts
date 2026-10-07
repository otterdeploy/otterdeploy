/**
 * A declared change to an existing service's CPU/memory limits and
 * reservations, or to its restart policy, has to stage an update. It staged
 * nothing, so the change never reached the container (only disk/swap/pids and
 * the restart window were compared).
 *
 * The comparisons follow what apply writes (buildResourcesPatch,
 * toRestartUpdateColumns): a declared `resources` block replaces every limit,
 * an omitted key meaning "no limit"; restart fields other than `condition` are
 * declared-only, because apply leaves an omitted one alone.
 */
import { describe, expect, it } from "vite-plus/test";

import { diffManifest, type CurrentService, type CurrentState } from "../diff";
import { manifestSchema } from "../schema";

function live(over: Partial<CurrentService> = {}): CurrentState {
  return {
    services: {
      web: {
        name: "web",
        source: "image",
        image: "ghcr.io/acme/api:1.0.0",
        sourceSubdir: null,
        repo: null,
        branch: null,
        imageRepository: null,
        replicas: 1,
        command: null,
        entrypoint: null,
        ports: [],
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
        ...over,
      },
    },
    databases: {},
    composes: {},
  };
}

/** The diff for a `web` image service declaring `extra`. */
function diffWeb(extra: Record<string, unknown>, current: CurrentState) {
  const manifest = manifestSchema.parse({
    project: "acme",
    services: { web: { source: "image", image: "ghcr.io/acme/api:1.0.0", ...extra } },
  });
  return diffManifest(manifest, current);
}

function fields(changes: ReturnType<typeof diffWeb>): unknown {
  const [change] = changes;
  return change?.kind === "update" ? change.details?.fields : change?.kind;
}

const NO_OP = [{ kind: "no-op", resource: "service", name: "web" }];

describe("manifest diff: resources on an existing service", () => {
  it("stages a changed memory limit (a 128 MiB cap)", () => {
    expect(fields(diffWeb({ resources: { memoryMb: 128 } }, live({ memoryLimitMb: 512 })))).toEqual(
      {
        memoryLimitMb: { from: 512, to: 128 },
      },
    );
  });

  it("stages a changed CPU limit and both reservations", () => {
    const declared = {
      resources: { cpuLimit: 1.5, cpuReservation: 0.25, memoryReservationMb: 64 },
    };
    expect(fields(diffWeb(declared, live({ cpuLimit: 0.5 })))).toEqual({
      cpuLimit: { from: 0.5, to: 1.5 },
      cpuReservation: { from: null, to: 0.25 },
      memoryReservationMb: { from: null, to: 64 },
    });
  });

  it("reads a key the declared block omits as no limit, as apply writes it", () => {
    expect(
      fields(diffWeb({ resources: { memoryMb: 256 } }, live({ memoryLimitMb: 256, cpuLimit: 2 }))),
    ).toEqual({
      cpuLimit: { from: 2, to: null },
    });
  });

  it("compares CPU at the column's two decimals, so an applied value settles", () => {
    expect(diffWeb({ resources: { cpuLimit: 0.333 } }, live({ cpuLimit: 0.33 }))).toEqual(NO_OP);
  });

  it("is a no-op once applied, and leaves limits alone when resources is omitted", () => {
    const applied = live({
      cpuLimit: 1,
      memoryLimitMb: 512,
      cpuReservation: 0.5,
      memoryReservationMb: 128,
    });
    const declared = {
      resources: { cpuLimit: 1, memoryMb: 512, cpuReservation: 0.5, memoryReservationMb: 128 },
    };
    expect(diffWeb(declared, applied)).toEqual(NO_OP);
    expect(diffWeb({}, applied)).toEqual(NO_OP);
  });
});

describe("manifest diff: restart policy on an existing service", () => {
  it("stages a changed condition, attempt cap and delay", () => {
    const declared = { restart: { condition: "any", maxAttempts: 3, delayMs: 1000 } };
    expect(fields(diffWeb(declared, live()))).toEqual({
      restartCondition: { from: "on-failure", to: "any" },
      restartMaxAttempts: { from: null, to: 3 },
      restartDelayMs: { from: 5000, to: 1000 },
    });
  });

  it("stages clearing the attempt cap with an explicit null", () => {
    const declared = { restart: { condition: "on-failure", maxAttempts: null } };
    expect(fields(diffWeb(declared, live({ restartMaxAttempts: 5 })))).toEqual({
      restartMaxAttempts: { from: 5, to: null },
    });
  });

  it("leaves undeclared restart fields to the live row (apply does not touch them)", () => {
    const current = live({ restartMaxAttempts: 5, restartDelayMs: 2000, restartWindowMs: 60_000 });
    expect(diffWeb({ restart: { condition: "on-failure" } }, current)).toEqual(NO_OP);
    expect(diffWeb({}, live({ restartCondition: "none" }))).toEqual(NO_OP);
  });
});
