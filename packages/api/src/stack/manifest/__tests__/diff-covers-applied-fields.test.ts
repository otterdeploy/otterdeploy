/**
 * Every service field apply WRITES, the diff must be able to REPORT.
 *
 * The diff's own header calls itself a "truthful preview before committing to
 * apply", and the pending-changes bar, `deploy --dry-run` and the apply
 * selection (`only`) are all built on it. So a field apply writes but the diff
 * cannot see is not a cosmetic gap — it is drift the product asserts does not
 * exist:
 *
 *   1. the operator edits the field and saves the manifest;
 *   2. `diff` reports nothing, so the bar is empty and `--dry-run` prints
 *      nothing — the UI says the project is up to date;
 *   3. the live service keeps the old value, indefinitely;
 *   4. then some unrelated change to the SAME service triggers an apply, which
 *      writes every field from `buildResourcesPatch` / the restart + healthcheck
 *      patches at once — so the limit or healthcheck changes as a silent side
 *      effect of something else, at a moment nobody chose.
 *
 * This is the mirror image of the phantom-diff bugs already fixed here (od-8kqp,
 * od-y64.8): those reported changes apply would not make. These are changes
 * apply makes that were never reported.
 *
 * `buildResourcesPatch` in routers/project/manifest-apply-service-input.ts
 * writes seven resource columns; the diff compared three. The restart patch
 * writes four; the diff compared one. The healthcheck patch writes five; the
 * diff carried none of them at all.
 */
import { describe, expect, it } from "vite-plus/test";

import type { CurrentService, CurrentState } from "../diff";
import type { Manifest } from "../schema";

import { diffManifest } from "../diff";
import { manifestSchema } from "../schema";

/** A live service with nothing set, so each case below varies exactly one field. */
function liveService(overrides: Partial<CurrentService> = {}): CurrentService {
  return {
    name: "api",
    source: "image",
    image: "nginx",
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
    restartCondition: "any",
    restartMaxAttempts: null,
    restartDelayMs: 5000,
    restartWindowMs: null,
    healthcheckCmd: null,
    healthcheckIntervalMs: null,
    healthcheckTimeoutMs: null,
    healthcheckRetries: null,
    healthcheckStartMs: null,
    cpuLimit: null,
    memoryLimitMb: null,
    cpuReservation: null,
    memoryReservationMb: null,
    diskLimitMb: null,
    swapLimitMb: null,
    pidsLimit: null,
    ...overrides,
  };
}

function stateWith(service: CurrentService): CurrentState {
  return { services: { api: service }, databases: {}, composes: {} };
}

function manifestWith(service: Record<string, unknown>): Manifest {
  return manifestSchema.parse({
    project: "acme-api",
    services: { api: { source: "image", image: "nginx", ...service } },
  });
}

/**
 * Each row: a declared spec, and a live service that differs from it in exactly
 * one field. The diff must report an update for every one.
 */
const cases: Array<{
  field: string;
  declared: Record<string, unknown>;
  live: Partial<CurrentService>;
}> = [
  // Resource limits and reservations: the four knobs an operator actually tunes.
  { field: "resources.cpuLimit", declared: { resources: { cpuLimit: 2 } }, live: { cpuLimit: 1 } },
  {
    field: "resources.memoryMb",
    declared: { resources: { memoryMb: 2048 } },
    live: { memoryLimitMb: 512 },
  },
  {
    field: "resources.cpuReservation",
    declared: { resources: { cpuReservation: 1 } },
    live: { cpuReservation: 0.5 },
  },
  {
    field: "resources.memoryReservationMb",
    declared: { resources: { memoryReservationMb: 1024 } },
    live: { memoryReservationMb: 256 },
  },
  // Restart policy beyond the window.
  {
    field: "restart.condition",
    declared: { restart: { condition: "on-failure" } },
    live: { restartCondition: "any" },
  },
  {
    field: "restart.maxAttempts",
    declared: { restart: { condition: "on-failure", maxAttempts: 3 } },
    live: { restartCondition: "on-failure", restartMaxAttempts: null },
  },
  {
    field: "restart.delayMs",
    declared: { restart: { condition: "any", delayMs: 10_000 } },
    live: { restartCondition: "any", restartDelayMs: 5000 },
  },
  // The healthcheck block, which the diff could not represent at all.
  {
    field: "healthcheck.cmd",
    declared: { healthcheck: { cmd: ["curl", "-f", "http://localhost/health"] } },
    live: { healthcheckCmd: ["true"] },
  },
  {
    field: "healthcheck.intervalMs",
    declared: { healthcheck: { cmd: ["true"], intervalMs: 30_000 } },
    live: { healthcheckCmd: ["true"], healthcheckIntervalMs: 10_000 },
  },
  {
    field: "healthcheck.timeoutMs",
    declared: { healthcheck: { cmd: ["true"], timeoutMs: 5000 } },
    live: { healthcheckCmd: ["true"], healthcheckTimeoutMs: 1000 },
  },
  {
    field: "healthcheck.retries",
    declared: { healthcheck: { cmd: ["true"], retries: 5 } },
    live: { healthcheckCmd: ["true"], healthcheckRetries: 3 },
  },
  {
    field: "healthcheck.startMs",
    declared: { healthcheck: { cmd: ["true"], startMs: 20_000 } },
    live: { healthcheckCmd: ["true"], healthcheckStartMs: 0 },
  },
];

describe("the diff reports every field apply writes", () => {
  for (const { field, declared, live } of cases) {
    it(`reports a change to ${field}`, () => {
      const changes = diffManifest(manifestWith(declared), stateWith(liveService(live)));
      const update = changes.find((change) => change.kind === "update");

      // No update here means the operator cannot see this drift, cannot select
      // it in the pending-changes bar, and will get it applied later as a side
      // effect of an unrelated change to the same service.
      expect(update, `no update reported for ${field}`).toBeDefined();
    });
  }

  it("reports nothing when the live service already matches the declaration", () => {
    // The other half of the invariant: agreement must be silent, or the bar
    // never clears. This is the phantom-diff failure the port normalization
    // (od-8kqp) and `declaredEnvOf` were written to prevent.
    const declared = {
      resources: { cpuLimit: 2, memoryMb: 2048, cpuReservation: 1, memoryReservationMb: 1024 },
      restart: { condition: "on-failure", maxAttempts: 3, delayMs: 10_000, windowMs: 60_000 },
      healthcheck: {
        cmd: ["true"],
        intervalMs: 30_000,
        timeoutMs: 5000,
        retries: 5,
        startMs: 20_000,
      },
    };
    const live = liveService({
      cpuLimit: 2,
      memoryLimitMb: 2048,
      cpuReservation: 1,
      memoryReservationMb: 1024,
      restartCondition: "on-failure",
      restartMaxAttempts: 3,
      restartDelayMs: 10_000,
      restartWindowMs: 60_000,
      healthcheckCmd: ["true"],
      healthcheckIntervalMs: 30_000,
      healthcheckTimeoutMs: 5000,
      healthcheckRetries: 5,
      healthcheckStartMs: 20_000,
    });

    const changes = diffManifest(manifestWith(declared), stateWith(live));
    expect(changes.filter((change) => change.kind === "update")).toEqual([]);
  });

  /**
   * The other direction, and a bug of its own: a field the manifest OMITS must
   * be compared the way apply treats it, or the diff stages a change apply
   * refuses to make and the pending bar never clears.
   *
   * The three blocks do not agree, and that is deliberate — the diff has to
   * mirror each one:
   *   restart.*      omitted -> `restart?.x` is undefined -> column left alone
   *   resources.*    omitted -> buildResourcesPatch writes `?? null` -> cleared
   *   healthcheck.*  omitted -> buildHealthcheckPatch writes `?? null` -> cleared
   */
  describe("an omitted sub-field is compared the way apply treats it", () => {
    it("does not stage a restart change for a window the manifest never mentions", () => {
      // This was live: the diff read an omitted `windowMs` as null, staged
      // 60000 -> null, and `toRestartUpdateColumns` then left the column alone
      // because the value arrived as undefined. Reported again every diff after.
      const changes = diffManifest(
        manifestWith({ restart: { condition: "any" } }),
        stateWith(liveService({ restartCondition: "any", restartWindowMs: 60_000 })),
      );
      expect(changes.filter((change) => change.kind === "update")).toEqual([]);
    });

    it("does not stage restart attempts or delay the manifest never mentions", () => {
      const changes = diffManifest(
        manifestWith({ restart: { condition: "on-failure" } }),
        stateWith(
          liveService({
            restartCondition: "on-failure",
            restartMaxAttempts: 7,
            restartDelayMs: 30_000,
          }),
        ),
      );
      expect(changes.filter((change) => change.kind === "update")).toEqual([]);
    });

    it("still honours an EXPLICIT null maxAttempts, which means no cap", () => {
      // `maxAttempts` is nullable, so null is an instruction, not an omission.
      // Distinguishing the two is why the check is `in` rather than !== undefined.
      const changes = diffManifest(
        manifestWith({ restart: { condition: "on-failure", maxAttempts: null } }),
        stateWith(liveService({ restartCondition: "on-failure", restartMaxAttempts: 7 })),
      );
      expect(changes.find((change) => change.kind === "update")).toBeDefined();
    });

    it("DOES stage a resource clear, because declaring the block owns all of it", () => {
      // The opposite convention, matching buildResourcesPatch's `?? null`.
      const changes = diffManifest(
        manifestWith({ resources: { memoryMb: 512 } }),
        stateWith(liveService({ memoryLimitMb: 512, diskLimitMb: 8192 })),
      );
      expect(changes.find((change) => change.kind === "update")).toBeDefined();
    });

    it("skips a healthcheck the manifest omits entirely, rather than clearing it", () => {
      const changes = diffManifest(
        manifestWith({}),
        stateWith(liveService({ healthcheckCmd: ["true"], healthcheckIntervalMs: 10_000 })),
      );
      expect(changes.filter((change) => change.kind === "update")).toEqual([]);
    });

    it("also skips an explicitly null healthcheck, because apply leaves it alone", () => {
      // `buildHealthcheckPatch` maps both undefined and null to undefined, so a
      // manifest cannot clear a healthcheck. The diff must not promise it can.
      const changes = diffManifest(
        manifestWith({ healthcheck: null }),
        stateWith(liveService({ healthcheckCmd: ["true"] })),
      );
      expect(changes.filter((change) => change.kind === "update")).toEqual([]);
    });
  });
});
