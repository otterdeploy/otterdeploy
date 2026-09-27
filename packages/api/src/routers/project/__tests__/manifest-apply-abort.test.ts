/**
 * An apply that throws mid-pipeline still records what landed.
 *
 * The reconciler runs eight phases in sequence and writes
 * `lastAppliedManifest` after the last one. Per-resource failures were already
 * handled — they travel in `skipped[]`, and `snapshotAfterApply` reverts each
 * skipped resource to the previous manifest. A HARD throw was not: it skipped
 * the write entirely while leaving every row earlier phases had created.
 *
 * That loses more than a status line. Walk it through with a database created
 * in phase 1 and a throw in phase 2 (`loadRefTable` is a bare `db.select`
 * between them, so a connection blip is enough):
 *
 *   1. the `cache` database row exists;
 *   2. `lastAppliedManifest` still does not mention it;
 *   3. the operator hits `discard`, which reverts the manifest to that
 *      snapshot — so `cache` is no longer declared anywhere;
 *   4. `wasDeclaredBefore("cache")` now reads false, and `diffNamedMap`
 *      downgrades the delete of an unowned resource to a NO-OP;
 *   5. so `cache` is live, running and billable, absent from the manifest, and
 *      no diff will ever again offer to remove it.
 *
 * Writing the snapshot on the failure path fixes that, but only if the
 * resources the abort never reached are reported skipped — otherwise the
 * snapshot claims they landed and manufactures the same ghost from the other
 * side.
 */
import { describe, expect, it } from "vite-plus/test";

import { unreachedPlanEntries } from "../manifest-apply-support";

const ABORTED = "apply aborted before this resource was reached";

/** The plan shape `runApply` builds: one keyed list per resource-and-verb. */
function plan(over: Partial<Record<string, Array<{ name: string }>>> = {}) {
  return {
    databaseCreates: [],
    databaseUpdates: [],
    databaseDeletes: [],
    serviceCreates: [],
    serviceUpdates: [],
    serviceDeletes: [],
    composeCreates: [],
    ...over,
  };
}

describe("unreachedPlanEntries", () => {
  it("reports a planned resource no phase attempted", () => {
    const entries = unreachedPlanEntries(
      plan({ serviceCreates: [{ name: "api" }] }),
      new Set(),
      ABORTED,
    );
    expect(entries).toEqual([{ resource: "service", name: "api", reason: ABORTED }]);
  });

  it("stays silent about a resource a phase already reached", () => {
    // Reached means the phase ran it, so its real outcome — applied, or its own
    // entry in skipped[] — is already recorded. Adding a second entry here
    // would revert a resource that genuinely landed.
    const entries = unreachedPlanEntries(
      plan({ databaseCreates: [{ name: "cache" }] }),
      new Set(["database:cache"]),
      ABORTED,
    );
    expect(entries).toEqual([]);
  });

  it("splits a plan where the abort landed halfway", () => {
    // Phase 1 created the database; the throw happened before services ran.
    const entries = unreachedPlanEntries(
      plan({
        databaseCreates: [{ name: "cache" }],
        serviceCreates: [{ name: "api" }, { name: "web" }],
      }),
      new Set(["database:cache"]),
      ABORTED,
    );
    expect(entries).toEqual([
      { resource: "service", name: "api", reason: ABORTED },
      { resource: "service", name: "web", reason: ABORTED },
    ]);
  });

  it("derives the resource kind from the plan key, for all three kinds", () => {
    const entries = unreachedPlanEntries(
      plan({
        databaseDeletes: [{ name: "old-db" }],
        serviceUpdates: [{ name: "api" }],
        composeCreates: [{ name: "stack" }],
      }),
      new Set(),
      ABORTED,
    );
    expect(entries.map((entry) => `${entry.resource}:${entry.name}`).sort()).toEqual([
      "compose:stack",
      "database:old-db",
      "service:api",
    ]);
  });

  it("ignores a key it does not recognize rather than guessing a kind", () => {
    // Mislabelling the resource would send the entry to the wrong arm of
    // snapshotAfterApply, which reverts by (resource, name).
    const entries = unreachedPlanEntries({ somethingElse: [{ name: "x" }] }, new Set(), ABORTED);
    expect(entries).toEqual([]);
  });

  it("returns nothing for an empty plan, so a no-op apply adds no skips", () => {
    expect(unreachedPlanEntries(plan(), new Set(), ABORTED)).toEqual([]);
  });
});
