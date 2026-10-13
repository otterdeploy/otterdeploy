/**
 * An apply that throws part-way still records what landed.
 *
 * The reconciler writes `lastAppliedManifest` after its last phase. A
 * per-resource failure travels in `skipped[]` and is handled; a hard throw
 * (a connection blip in the `loadRefTable` read between phase 1 and the
 * services, say) skipped the write entirely while the rows earlier phases
 * created stayed. A database created in phase 1 was then missing from the
 * snapshot, so `discard` reverted to a manifest that never mentioned it, the
 * diff read it as never declared, and its delete was downgraded to a no-op:
 * live, running, and never offered for removal again.
 *
 * So the snapshot is written on the failure path too, with every resource the
 * abort never reached reported skipped (so it is not recorded as applied), and
 * the original error still reaches the caller.
 *
 * The phases, state reads and database are stood in for; the planner
 * (`diffManifest` + `groupChanges`) is real.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/** What `snapshotAfterApply` is handed, narrowed to the part under test. */
interface SnapshotArgs {
  skipped: Array<{ resource: string; name: string; reason: string }>;
}

const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  snapshotAfterApply: vi.fn((_args: SnapshotArgs) => ({
    project: "acme-api",
    services: {},
    databases: {},
    composes: {},
  })),
  loadRefTable: vi.fn<() => Promise<unknown>>(),
  runDatabaseCreates: vi.fn(),
}));

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => ({ $withCache: () => Promise.resolve([{}]) }) }),
      }),
    }),
    update: () => ({ set: mocks.updateSet.mockReturnValue({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock("../manifest-applied-snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../manifest-applied-snapshot")>()),
  snapshotAfterApply: mocks.snapshotAfterApply,
}));
vi.mock("../queries/resource", () => ({
  resolveProjectEnvironmentScope: () =>
    Promise.resolve({ environmentId: idSchema.environment.parse("env_1"), isMain: true }),
}));
vi.mock("../manifest-state", () => ({
  loadCurrentState: () => Promise.resolve({ services: {}, databases: {}, composes: {} }),
}));
vi.mock("../project-event-bus", () => ({ publishManifestChanged: vi.fn() }));
vi.mock("../../../lib/escape-hatch", () => ({ writeProjectEscapeHatch: () => Promise.resolve() }));
vi.mock("../manifest-apply-git", () => ({ enqueueGitBuild: vi.fn() }));
vi.mock("../manifest-apply-refs", () => ({
  loadRefTable: mocks.loadRefTable,
  makeEnvRefResolver: () => () => null,
  withStagedServices: (table: unknown) => table,
}));

const emptyPhase = { applied: 0, skipped: [], gitBuilds: [] };
vi.mock("../manifest-apply-phases", () => ({
  runDatabaseCreates: mocks.runDatabaseCreates,
  runDatabaseUpdates: vi.fn(() => Promise.resolve(emptyPhase)),
  runDatabaseDeletes: vi.fn(() => Promise.resolve(emptyPhase)),
  runComposeCreates: vi.fn(() => Promise.resolve(emptyPhase)),
  runServiceDeletes: vi.fn(() => Promise.resolve(emptyPhase)),
  runGitBuilds: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../manifest-apply-phases-services", () => ({
  runServiceCreates: vi.fn(() => Promise.resolve(emptyPhase)),
  runServiceUpdates: vi.fn(() => Promise.resolve(emptyPhase)),
  unbuiltGitServices: vi.fn(() => Promise.resolve([])),
}));

const { applyManifest } = await import("../manifest-apply");
const { manifestSchema } = await import("../../../stack/manifest");

const log: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

/** One database (phase 1, lands) and one service (never reached: the read
 *  between them throws). */
const manifest = manifestSchema.parse({
  project: "acme-api",
  databases: { cache: { engine: "postgres" } },
  services: { api: { source: "image", image: "nginx" } },
});

const emptyRefTable = { databases: new Map(), services: new Map() };
const connectionLost = new Error("connection terminated unexpectedly");

function apply() {
  return applyManifest({
    projectId: idSchema.project.parse("prj_1"),
    organizationId: idSchema.organization.parse("org_1"),
    manifest,
    log,
  });
}

describe("an apply that throws part-way", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runDatabaseCreates.mockResolvedValue({ applied: 1, skipped: [], gitBuilds: [] });
    // The planning read succeeds (nothing is written yet); the phase-2 read,
    // after the database landed, does not.
    mocks.loadRefTable.mockResolvedValueOnce(emptyRefTable).mockRejectedValue(connectionLost);
  });

  it("still rejects with the original error", async () => {
    await expect(apply()).rejects.toBe(connectionLost);
  });

  it("writes the applied snapshot anyway, so phase 1's work is recorded", async () => {
    await expect(apply()).rejects.toThrow();

    // Once for the project-wide snapshot, once for the environment's own.
    expect(mocks.snapshotAfterApply).toHaveBeenCalledTimes(2);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ lastAppliedManifest: expect.anything() }),
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        appliedManifest: expect.anything(),
        appliedManifestResolved: expect.anything(),
      }),
    );
  });

  it("reports what the abort never reached as skipped, and nothing that ran", async () => {
    await expect(apply()).rejects.toThrow();

    const skipped = mocks.snapshotAfterApply.mock.calls.at(-1)?.[0].skipped ?? [];
    expect(skipped.map(({ resource, name }) => `${resource}:${name}`)).toEqual(["service:api"]);
  });

  it("still rejects with the original error when the snapshot write fails too", async () => {
    mocks.updateSet.mockImplementationOnce(() => {
      throw new Error("still disconnected");
    });

    await expect(apply()).rejects.toBe(connectionLost);
  });
});
