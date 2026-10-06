/**
 * The failure path of `runApply`, end to end over mocked phases.
 *
 * Companion to manifest-apply-abort.test.ts, which covers the pure part. This
 * one pins the behaviour that actually matters: when a phase throws, the
 * snapshot is still written, the resources the abort never reached are
 * reported skipped, and the original error still reaches the caller unchanged.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it, vi } from "vite-plus/test";

/** What `snapshotAfterApply` is handed, narrowed to the part under test. */
interface SnapshotArgs {
  skipped: Array<{ resource: string; name: string; reason: string }>;
}

const updateSet = vi.fn();
const snapshotAfterApply = vi.fn((_args: SnapshotArgs) => ({
  project: "acme-api",
  services: {},
  databases: {},
  composes: {},
}));

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{}]) }) }) }),
    update: () => ({ set: updateSet.mockReturnValue({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock("../manifest-applied-snapshot", () => ({ snapshotAfterApply }));
vi.mock("../queries/resource", () => ({
  resolveProjectEnvironmentScope: () =>
    Promise.resolve({ environmentId: idSchema.environment.parse("env_1"), isMain: true }),
}));
vi.mock("../manifest-state", () => ({
  loadCurrentState: () => Promise.resolve({ services: {}, databases: {}, composes: {} }),
}));
vi.mock("../manifest", () => ({ loadAppliedSnapshot: () => Promise.resolve(null) }));
vi.mock("../project-event-bus", () => ({ publishManifestChanged: vi.fn() }));
vi.mock("../../../lib/escape-hatch", () => ({ writeProjectEscapeHatch: () => Promise.resolve() }));

/**
 * `loadRefTable` is called twice: once to PLAN (before any phase runs, outside
 * the failure boundary — nothing has been written yet, so a throw there is
 * harmless) and once as phase 2, after phase 1 has created databases. Only the
 * second one is the dangerous case, so the first resolves and the second
 * rejects. In production this is a bare `db.select`, so a connection blip is
 * all it takes.
 */
const refTableBoom = new Error("connection terminated unexpectedly");
const emptyRefTable = { databases: new Map(), services: new Map() };
const loadRefTable = vi
  .fn<() => Promise<unknown>>()
  .mockResolvedValueOnce(emptyRefTable)
  .mockRejectedValue(refTableBoom);
vi.mock("../manifest-apply-refs", () => ({
  loadRefTable,
  makeEnvRefResolver: () => () => null,
}));

const emptyPhase = { applied: 0, skipped: [], gitBuilds: [] };
vi.mock("../manifest-apply-phases", () => ({
  // Phase 1 succeeds: this is the write that would be lost.
  runDatabaseCreates: vi.fn(() => Promise.resolve({ applied: 1, skipped: [], gitBuilds: [] })),
  runDatabaseUpdates: vi.fn(() => Promise.resolve(emptyPhase)),
  runDatabaseDeletes: vi.fn(() => Promise.resolve(emptyPhase)),
  runComposeCreates: vi.fn(() => Promise.resolve(emptyPhase)),
  runServiceDeletes: vi.fn(() => Promise.resolve(emptyPhase)),
  runGitBuilds: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../manifest-apply-phases-services", () => ({
  runServiceCreates: vi.fn(() => Promise.resolve(emptyPhase)),
  runServiceUpdates: vi.fn(() => Promise.resolve(emptyPhase)),
}));

const { applyManifest } = await import("../manifest-apply");
const { manifestSchema } = await import("../../../stack/manifest");

// Same shape the other apply tests use, so no assertion is needed to pass it.
const log: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

/** A manifest with one database (phase 1, succeeds) and one service (never
 *  reached, because phase 2 throws in between). */
const manifest = manifestSchema.parse({
  project: "acme-api",
  databases: { cache: { engine: "postgres" } },
  services: { api: { source: "image", image: "nginx" } },
});

function apply() {
  loadRefTable.mockReset();
  loadRefTable.mockResolvedValueOnce(emptyRefTable).mockRejectedValue(refTableBoom);
  return applyManifest({
    projectId: idSchema.project.parse("prj_1"),
    organizationId: idSchema.organization.parse("org_1"),
    manifest,
    log,
  });
}

describe("runApply, when a phase throws", () => {
  it("still propagates the original error to the caller", async () => {
    // No `catch` was added, only `finally`: the caller must see the real cause,
    // not a wrapped or swallowed one.
    await expect(apply()).rejects.toThrow("connection terminated unexpectedly");
  });

  it("writes the applied snapshot anyway, so phase 1's work is recorded", async () => {
    updateSet.mockClear();
    snapshotAfterApply.mockClear();

    await expect(apply()).rejects.toThrow();

    // Before the fix this never ran, and the database created in phase 1 became
    // an orphan: live, undeclared, and downgraded to a no-op by every later diff.
    expect(snapshotAfterApply).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalled();
  });

  it("reports the resources the abort never reached as skipped", async () => {
    snapshotAfterApply.mockClear();

    await expect(apply()).rejects.toThrow();

    const skipped = snapshotAfterApply.mock.calls.at(-1)?.[0]?.skipped ?? [];
    // `api` never ran, so the snapshot must NOT claim it landed — otherwise the
    // ghost reappears from the other direction.
    expect(skipped.some((s) => s.resource === "service" && s.name === "api")).toBe(true);
    // `cache` DID run in phase 1, so it must not be reverted.
    expect(skipped.some((s) => s.name === "cache")).toBe(false);
  });
});
