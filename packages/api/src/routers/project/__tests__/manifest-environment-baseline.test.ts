/**
 * The pure rules behind per-environment pending changes: what may be deleted,
 * what an apply records, and what a discard in one environment writes.
 * manifest-environment-baseline.postgres.test.ts drives the same rules
 * through the real procedures.
 */
import { describe, expect, it } from "vite-plus/test";

import { manifestSchema, resolveEnvironment, type Manifest } from "../../../stack/manifest";
import {
  documentAfterApply,
  manifestAfterEnvironmentDiscard,
  untracedDeletes,
} from "../manifest-environment-baseline";

const redis = { engine: "redis" as const, version: "7.4" };
const pg = (version: string) => ({ engine: "postgres" as const, version });

function manifest(partial: Record<string, unknown> = {}): Manifest {
  return manifestSchema.parse({
    project: "acme",
    services: {},
    databases: {},
    composes: {},
    ...partial,
  });
}

function resolved(m: Manifest | null, environment: string): Manifest | null {
  if (!m) return null;
  const out = resolveEnvironment(m, environment);
  if (out.isErr()) throw out.error;
  return out.value;
}

describe("untracedDeletes", () => {
  const live = { kind: "delete", resource: "database", name: "cache" };

  it("a delete of something this environment applied and the manifest dropped is traced", () => {
    expect(
      untracedDeletes([live], {
        desired: manifest(),
        applied: manifest({ databases: { cache: redis } }),
      }),
    ).toEqual([]);
  });

  it("a delete with no apply behind it is untraced", () => {
    expect(untracedDeletes([live], { desired: manifest(), applied: null })).toEqual([
      { resource: "database", name: "cache" },
    ]);
    expect(untracedDeletes([live], { desired: manifest(), applied: manifest() })).toEqual([
      { resource: "database", name: "cache" },
    ]);
  });

  it("a same-name replace is traced by the resource still being declared", () => {
    const replace = { kind: "delete", resource: "database", name: "cache" };
    expect(
      untracedDeletes([replace], {
        desired: manifest({ databases: { cache: pg("18") } }),
        applied: null,
      }),
    ).toEqual([]);
  });

  it("variable deletes are not resource deletes", () => {
    const variable = { kind: "delete", resource: "env", name: "api.TOKEN" };
    expect(untracedDeletes([variable], { desired: manifest(), applied: null })).toEqual([]);
  });
});

describe("documentAfterApply", () => {
  it("a skipped resource keeps its previous base entry and its entry in this block", () => {
    const previous = manifest({
      databases: { db: pg("17") },
      environments: { staging: { databases: { db: { version: "17" } } } },
    });
    const submitted = manifest({
      databases: { db: pg("18"), cache: redis },
      environments: { staging: { databases: { db: { version: "18" } } } },
    });
    const out = documentAfterApply({
      submitted,
      previous,
      skipped: [{ resource: "database", name: "db" }],
      environment: "staging",
    });
    expect(out.databases).toEqual({ db: pg("17"), cache: redis });
    expect(out.environments?.staging?.databases?.db).toEqual({ version: "17" });
  });
});

describe("manifestAfterEnvironmentDiscard", () => {
  it("reverts each named resource and keeps every other staged edit", () => {
    const out = manifestAfterEnvironmentDiscard({
      manifest: manifest({ databases: { redis, cache: redis } }),
      baseline: manifest(),
      environment: undefined,
      resources: [{ resource: "database", name: "redis" }],
      appliedElsewhere: [],
    });
    expect(out?.databases).toEqual({ cache: redis });
  });

  it("goes back to the baseline whole when nothing readable is staged", () => {
    const baseline = manifest({ databases: { db: pg("18") } });
    const args = { environment: "production", resources: [], appliedElsewhere: [] };
    expect(manifestAfterEnvironmentDiscard({ ...args, manifest: null, baseline })).toBe(baseline);
    expect(manifestAfterEnvironmentDiscard({ ...args, manifest: null, baseline: null })).toBeNull();
  });

  it("does not fold another environment's override into the base", () => {
    // The document production last applied, with staging's own override.
    const baseline = manifest({
      databases: { db: { ...pg("18"), extraEnv: { LOG_LEVEL: "info" } } },
      environments: {
        production: {},
        staging: { databases: { db: { extraEnv: { LOG_LEVEL: "debug" } } } },
      },
    });
    const staged = manifest({
      ...baseline,
      databases: { ...baseline.databases, cache: redis },
    });
    const out = manifestAfterEnvironmentDiscard({
      manifest: staged,
      baseline,
      environment: "production",
      resources: [{ resource: "database", name: "cache" }],
      appliedElsewhere: [],
    });
    expect(resolved(out, "production")?.databases).toEqual(
      resolved(baseline, "production")?.databases,
    );
    expect(resolved(out, "staging")?.databases.db).toEqual(
      resolved(baseline, "staging")?.databases.db,
    );
  });

  it("opts this environment out instead of dropping a resource another one runs", () => {
    const shared = manifest({ databases: { db: pg("18"), cache: redis } });
    const out = manifestAfterEnvironmentDiscard({
      manifest: shared,
      baseline: manifest({ databases: { db: pg("18") } }),
      environment: "production",
      resources: [{ resource: "database", name: "cache" }],
      appliedElsewhere: [shared],
    });
    expect(out?.databases.cache).toEqual(redis);
    expect(out?.environments?.production?.databases?.cache).toBeNull();
    expect(resolved(out, "production")?.databases.cache).toBeUndefined();
    expect(resolved(out, "staging")?.databases.cache).toEqual(redis);
  });

  it("takes an unwanted create out of the base when nothing else runs it", () => {
    const out = manifestAfterEnvironmentDiscard({
      manifest: manifest({ databases: { db: pg("18"), cache: redis } }),
      baseline: manifest({ databases: { db: pg("18") } }),
      environment: "production",
      resources: [{ resource: "database", name: "cache" }],
      appliedElsewhere: [manifest({ databases: { db: pg("18") } })],
    });
    expect(out?.databases).toEqual({ db: pg("18") });
    expect(out?.environments?.production?.databases).toBeUndefined();
  });

  it("restores a resource this environment ran when its removal is discarded", () => {
    const out = manifestAfterEnvironmentDiscard({
      manifest: manifest({
        environments: { staging: { databases: { db: null } } },
        databases: { db: pg("18") },
      }),
      baseline: manifest({ databases: { db: pg("18") }, environments: { staging: {} } }),
      environment: "staging",
      resources: [{ resource: "database", name: "db" }],
      appliedElsewhere: [],
    });
    expect(resolved(out, "staging")?.databases.db).toEqual(pg("18"));
  });
});
