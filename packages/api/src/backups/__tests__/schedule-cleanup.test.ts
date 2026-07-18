/**
 * Deletion-side pruning decisions for backup schedules. `planSchedulePrune`
 * decides, for one schedule, which `sources` refs survive after a database
 * resource is deleted and whether the schedule must be disabled (no live
 * source left). These cases pin the id/name pruning and the disable-on-empty
 * rule that closes the orphaned-schedule bug (FK-less jsonb `sources`).
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { describe, expect, it } from "vite-plus/test";

import { planSchedulePrune } from "../schedule-cleanup";

const db = (id: string, name: string) => ({ id: id as ResourceId, name });

describe("planSchedulePrune", () => {
  it("is a no-op when every source still resolves", () => {
    const live = [db("resource_a", "postgres-main"), db("resource_b", "redis-cache")];
    const r = planSchedulePrune(["resource_a", "resource_b"], live);
    expect(r).toEqual({
      nextSources: ["resource_a", "resource_b"],
      changed: false,
      disable: false,
    });
  });

  it("prunes an id ref whose resource was deleted, keeping the survivor", () => {
    // resource_a deleted; only resource_b remains live.
    const live = [db("resource_b", "redis-cache")];
    const r = planSchedulePrune(["resource_a", "resource_b"], live);
    expect(r.nextSources).toEqual(["resource_b"]);
    expect(r.changed).toBe(true);
    expect(r.disable).toBe(false);
  });

  it("disables a schedule whose last source went missing", () => {
    const r = planSchedulePrune(["resource_a"], []);
    expect(r.nextSources).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.disable).toBe(true);
  });

  it("prunes a by-name ref only when no same-named sibling survives", () => {
    // The deleted resource was referenced by name; a sibling in another project
    // still carries that name, so the ref legitimately still resolves.
    const live = [db("resource_sibling", "postgres-main")];
    const r = planSchedulePrune(["postgres-main"], live);
    expect(r.changed).toBe(false);
    expect(r.nextSources).toEqual(["postgres-main"]);
  });

  it("removes a by-name ref once the last holder of the name is gone", () => {
    const r = planSchedulePrune(["postgres-main"], [db("resource_other", "redis-cache")]);
    expect(r.nextSources).toEqual([]);
    expect(r.disable).toBe(true);
  });

  it("prunes only the dead refs from a mixed source list", () => {
    const live = [db("resource_b", "redis-cache")];
    const r = planSchedulePrune(["resource_a", "resource_b", "gone-by-name"], live);
    expect(r.nextSources).toEqual(["resource_b"]);
    expect(r.disable).toBe(false);
  });
});
