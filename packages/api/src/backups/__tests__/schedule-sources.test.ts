/**
 * Source-resolution tests for backup schedules. `partitionSources` decides
 * whether a schedule can still run: a ref that no longer matches a live
 * database resource is "missing" (its DB was deleted), which drives both the
 * orphaned-schedule warning in the UI and the 422 on manual "run now". These
 * cases pin the id/name matching and the deleted-source path.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { describe, expect, it } from "vite-plus/test";

import { partitionSources } from "../schedule-db";

const db = (id: string, name: string) => ({ id: id as ResourceId, name, kind: "database" as const });
const stack = (id: string, name: string) => ({ id: id as ResourceId, name, kind: "stack" as const });

const ids = (r: ReturnType<typeof partitionSources>) => r.resolved.map((x) => x.id).sort();

const resources = [db("resource_a", "postgres-main"), db("resource_b", "redis-cache")];

describe("partitionSources", () => {
  it("resolves refs by resource id", () => {
    const r = partitionSources(["resource_a"], resources);
    expect(r.resolved).toEqual([{ id: "resource_a", kind: "database" }]);
    expect(r.missing).toEqual([]);
  });

  it("resolves refs by resource name", () => {
    const r = partitionSources(["postgres-main"], resources);
    expect(r.resolved).toEqual([{ id: "resource_a", kind: "database" }]);
    expect(r.missing).toEqual([]);
  });

  it("tags a compose-stack DB service as a `stack` source", () => {
    const candidates = [db("resource_a", "postgres-main"), stack("svc_x", "authentik-postgres")];
    const r = partitionSources(["svc_x"], candidates);
    expect(r.resolved).toEqual([{ id: "svc_x", kind: "stack" }]);
    expect(r.missing).toEqual([]);
  });

  it("flags a ref whose backing database no longer exists as missing", () => {
    // The real prod bug: schedule points at a deleted database resource.
    const r = partitionSources(["resource_gone"], resources);
    expect(r.resolved).toEqual([]);
    expect(r.missing).toEqual(["resource_gone"]);
  });

  it("partitions a mix of live and dead refs", () => {
    const r = partitionSources(["resource_a", "resource_gone", "redis-cache"], resources);
    expect(ids(r)).toEqual(["resource_a", "resource_b"]);
    expect(r.missing).toEqual(["resource_gone"]);
  });

  it("treats every ref as missing when all databases are gone (fully orphaned)", () => {
    const r = partitionSources(["resource_a", "postgres-main"], []);
    expect(r.resolved).toEqual([]);
    expect(r.missing).toEqual(["resource_a", "postgres-main"]);
  });

  it("returns empty partitions for a schedule with no sources", () => {
    expect(partitionSources([], resources)).toEqual({ resolved: [], missing: [] });
  });

  it("fans a by-name ref out to every same-named resource", () => {
    const dupes = [db("resource_a", "db"), db("resource_b", "db")];
    const r = partitionSources(["db"], dupes);
    expect(ids(r)).toEqual(["resource_a", "resource_b"]);
    expect(r.missing).toEqual([]);
  });
});
