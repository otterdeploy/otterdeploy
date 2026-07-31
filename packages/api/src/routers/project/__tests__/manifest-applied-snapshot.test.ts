/**
 * The applied snapshot must record what landed, not what was submitted.
 *
 * The incident these pin: a project's manifest carried a database entry named
 * `mariadb-` with no matching resource, sitting next to the real `mariadb`.
 * Apply died with "Resource 'mariadb-' was created concurrently" — the
 * sanitized name collides with the existing row — and Discard returned 200
 * while changing nothing. The change could be neither applied nor discarded,
 * and the pending-changes bar never cleared.
 *
 * Cause: the reconciler is partial by design (failures land in `skipped[]` and
 * the run continues), but `lastAppliedManifest` was written as the whole
 * submitted manifest regardless. Discard reverts TO that snapshot, so a failed
 * create became permanent.
 */

import { describe, expect, it } from "vite-plus/test";

import type { Manifest } from "../../../stack/manifest";

import {
  manifestAfterDiscard,
  revertEntries,
  snapshotAfterApply,
} from "../manifest-applied-snapshot";

const db = (version: string) => ({ engine: "mariadb", version }) as never;
const svc = (repo: string) => ({ source: "git", repo }) as never;

function manifest(parts: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    project: "store",
    services: {},
    databases: {},
    composes: {},
    ...parts,
  } as Manifest;
}

describe("snapshotAfterApply", () => {
  it("returns the submitted manifest untouched when nothing was skipped", () => {
    const submitted = manifest({ databases: { mariadb: db("11.4") } });
    expect(snapshotAfterApply({ submitted, previous: null, skipped: [] })).toBe(submitted);
  });

  it("drops a create that was skipped", () => {
    // The regression, stated directly: `mariadb-` failed to create, so the
    // snapshot must not claim it exists.
    const submitted = manifest({
      databases: { mariadb: db("11.4"), "mariadb-": db("11.4") },
    });
    const previous = manifest({ databases: { mariadb: db("11.4") } });

    const out = snapshotAfterApply({
      submitted,
      previous,
      skipped: [{ resource: "database", name: "mariadb-" }],
    });

    expect(Object.keys(out.databases ?? {})).toEqual(["mariadb"]);
  });

  it("breaks the apply/discard deadlock: the next diff proposes the create again", () => {
    // With the bad entry out of the snapshot, discard (which reverts to it)
    // genuinely removes the pending change instead of restoring it.
    const submitted = manifest({ databases: { "mariadb-": db("11.4") } });
    const out = snapshotAfterApply({
      submitted,
      previous: manifest(),
      skipped: [{ resource: "database", name: "mariadb-" }],
    });
    expect(out.databases?.["mariadb-"]).toBeUndefined();
  });

  it("drops a skipped create when there is no previous snapshot at all", () => {
    // First apply a project ever runs — `previous` is null, not an empty one.
    const out = snapshotAfterApply({
      submitted: manifest({ services: { api: svc("me/api") } }),
      previous: null,
      skipped: [{ resource: "service", name: "api" }],
    });
    expect(out.services?.api).toBeUndefined();
  });

  it("restores the OLD spec when an update was skipped", () => {
    // The resource still runs the old spec, so the snapshot must say so and
    // the next diff must re-propose the update.
    const out = snapshotAfterApply({
      submitted: manifest({ databases: { mariadb: db("11.4") } }),
      previous: manifest({ databases: { mariadb: db("10.6") } }),
      skipped: [{ resource: "database", name: "mariadb" }],
    });
    expect(out.databases?.mariadb).toEqual(db("10.6"));
  });

  it("restores the entry when a delete was skipped", () => {
    // Submitted omits it — that omission IS the delete. The delete failed, so
    // the resource is still running and the snapshot has to say so, or the
    // next diff compares against a snapshot that already forgot it.
    const out = snapshotAfterApply({
      submitted: manifest({ services: {} }),
      previous: manifest({ services: { api: svc("me/api") } }),
      skipped: [{ resource: "service", name: "api" }],
    });
    expect(out.services?.api).toEqual(svc("me/api"));
  });

  it("leaves resources that applied cleanly alone", () => {
    const out = snapshotAfterApply({
      submitted: manifest({
        databases: { mariadb: db("11.4"), postgres: db("18") },
        services: { api: svc("me/api") },
      }),
      previous: manifest({ databases: { mariadb: db("10.6") } }),
      skipped: [{ resource: "database", name: "mariadb" }],
    });
    expect(out.databases?.mariadb).toEqual(db("10.6"));
    expect(out.databases?.postgres).toEqual(db("18"));
    expect(out.services?.api).toEqual(svc("me/api"));
  });

  it("reverts the owning resource when an env change was skipped", () => {
    // `env` is not its own section — the failure belongs to the service.
    const out = snapshotAfterApply({
      submitted: manifest({ services: { api: { source: "git", env: { A: "2" } } as never } }),
      previous: manifest({ services: { api: { source: "git", env: { A: "1" } } as never } }),
      skipped: [{ resource: "env", name: "api" }],
    });
    expect(out.services?.api).toEqual({ source: "git", env: { A: "1" } });
  });

  it("handles a compose skip", () => {
    const out = snapshotAfterApply({
      submitted: manifest({ composes: { stack: { file: "x" } as never } }),
      previous: manifest(),
      skipped: [{ resource: "compose", name: "stack" }],
    });
    expect(out.composes?.stack).toBeUndefined();
  });

  it("does not mutate the submitted manifest", () => {
    const submitted = manifest({ databases: { "mariadb-": db("11.4") } });
    snapshotAfterApply({
      submitted,
      previous: manifest(),
      skipped: [{ resource: "database", name: "mariadb-" }],
    });
    expect(submitted.databases?.["mariadb-"]).toEqual(db("11.4"));
  });

  it("applies every skip when several fail at once", () => {
    const out = snapshotAfterApply({
      submitted: manifest({
        databases: { a: db("1"), b: db("2") },
        services: { c: svc("me/c") },
      }),
      previous: manifest({ databases: { b: db("1") } }),
      skipped: [
        { resource: "database", name: "a" },
        { resource: "database", name: "b" },
        { resource: "service", name: "c" },
      ],
    });
    expect(out.databases?.a).toBeUndefined();
    expect(out.databases?.b).toEqual(db("1"));
    expect(out.services?.c).toBeUndefined();
  });
});

// ────── Selective discard ──────
// Same primitive, the pending-changes bar's other half: drop ONE unwanted
// change without throwing away the operator's remaining staged edits. `target`
// is the working manifest, `source` the applied snapshot (deployed truth).
describe("revertEntries — selective discard", () => {
  it("drops a pending create and leaves the other edits staged", () => {
    const out = revertEntries({
      target: manifest({ databases: { redis: db("7"), cache: db("7") } }),
      source: manifest(),
      resources: [{ resource: "database", name: "redis" }],
    });
    expect(out.databases?.redis).toBeUndefined();
    expect(out.databases?.cache).toEqual(db("7"));
  });

  it("reverts a pending update back to the deployed spec", () => {
    const out = revertEntries({
      target: manifest({ databases: { mariadb: db("11.4") } }),
      source: manifest({ databases: { mariadb: db("10.6") } }),
      resources: [{ resource: "database", name: "mariadb" }],
    });
    expect(out.databases?.mariadb).toEqual(db("10.6"));
  });

  it("restores a resource whose pending DELETE is discarded", () => {
    // The omission from `target` IS the staged delete; undoing it has to bring
    // the entry back from the applied snapshot.
    const out = revertEntries({
      target: manifest({ services: {} }),
      source: manifest({ services: { api: svc("me/api") } }),
      resources: [{ resource: "service", name: "api" }],
    });
    expect(out.services?.api).toEqual(svc("me/api"));
  });

  it("is a no-op for a resource absent on both sides", () => {
    const out = revertEntries({
      target: manifest({ services: { api: svc("me/api") } }),
      source: manifest({ services: { api: svc("me/api") } }),
      resources: [{ resource: "service", name: "ghost" }],
    });
    expect(out.services?.api).toEqual(svc("me/api"));
    expect(out.services?.ghost).toBeUndefined();
  });

  it("discards several selected changes at once", () => {
    const out = revertEntries({
      target: manifest({ databases: { a: db("1") }, services: { b: svc("me/b") } }),
      source: manifest(),
      resources: [
        { resource: "database", name: "a" },
        { resource: "service", name: "b" },
      ],
    });
    expect(out.databases?.a).toBeUndefined();
    expect(out.services?.b).toBeUndefined();
  });

  it("returns the target untouched when nothing is selected", () => {
    const target = manifest({ databases: { a: db("1") } });
    expect(revertEntries({ target, source: manifest(), resources: [] })).toBe(target);
  });
});

describe("manifestAfterDiscard", () => {
  it("resets to the applied snapshot when nothing specific is named", () => {
    const applied = manifest({ databases: { mariadb: db("11.4") } });
    const out = manifestAfterDiscard({
      manifest: manifest({ databases: { mariadb: db("11.4"), redis: db("7") } }),
      applied,
    });
    expect(out).toBe(applied);
  });

  it("clears the manifest when the project was never applied", () => {
    expect(
      manifestAfterDiscard({ manifest: manifest({ services: { a: svc("me/a") } }), applied: null }),
    ).toBeNull();
  });

  it("keeps the other staged edits when one change is discarded", () => {
    const out = manifestAfterDiscard({
      manifest: manifest({ databases: { redis: db("7"), cache: db("7") } }),
      applied: manifest(),
      only: [{ resource: "database", name: "redis" }],
    });
    expect(out?.databases?.redis).toBeUndefined();
    expect(out?.databases?.cache).toEqual(db("7"));
  });

  it("falls back to the applied snapshot when there is no working manifest", () => {
    // manifest column null but changes staged elsewhere — must not throw.
    const out = manifestAfterDiscard({
      manifest: null,
      applied: manifest({ databases: { mariadb: db("11.4") } }),
      only: [{ resource: "database", name: "mariadb" }],
    });
    expect(out?.databases?.mariadb).toEqual(db("11.4"));
  });
});
