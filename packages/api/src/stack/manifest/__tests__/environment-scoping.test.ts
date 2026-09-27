/**
 * Removing a resource from ONE environment.
 *
 * merge.ts has always implemented `null` → delete, and said so at the top of
 * the file. The schema rejected null, so the branch was dead code and the
 * capability did not exist. These tests hold both halves together: the parse
 * boundary must accept the value, and the merge must act on it.
 */

import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironment } from "../merge";
import { manifestSchema, type Manifest } from "../schema";

/** Unwrap a merge that is expected to succeed. `resolveEnvironment` returns a
 *  Result because an environment block CAN merge into an invalid manifest, and
 *  that is a 400 the operator must see rather than a throw. Every fixture here
 *  is a valid one, so a failure means the fixture is wrong. */
function mergedFor(manifest: Manifest, environment?: string): Manifest {
  const result = resolveEnvironment(manifest, environment);
  if (result.isErr()) throw new Error(`fixture does not merge: ${result.error.message}`);
  return result.value;
}

const base = {
  project: "prj_yaskoq18h180nd9sr851lorj",
  services: {
    api: { source: "image" as const, image: "praxly/api:1" },
    "web-admin": { source: "image" as const, image: "praxly/admin:1" },
  },
  databases: {
    postgres: { engine: "postgres" as const, version: "18" },
    "postgres-prod": { engine: "postgres" as const, version: "18" },
  },
  environments: {
    staging: { databases: { "postgres-prod": null } },
    production: { services: { "web-admin": null } },
  },
};

describe("environment-scoped resources", () => {
  it("accepts a null resource override at the parse boundary", () => {
    expect(manifestSchema.safeParse(base).success).toBe(true);
  });

  it("removes the database the environment does not have", () => {
    const manifest = manifestSchema.parse(base);
    const staging = mergedFor(manifest, "staging");
    expect(Object.keys(staging.databases)).toEqual(["postgres"]);
    // Only the named resource goes: a scoping rule that also dropped siblings
    // would trade a phantom create for a phantom delete.
    expect(Object.keys(staging.services).sort()).toEqual(["api", "web-admin"]);
  });

  it("removes the service the environment does not have", () => {
    const manifest = manifestSchema.parse(base);
    const production = mergedFor(manifest, "production");
    expect(Object.keys(production.services)).toEqual(["api"]);
    expect(Object.keys(production.databases).sort()).toEqual(["postgres", "postgres-prod"]);
  });

  it("leaves the base manifest intact for an environment that scopes nothing", () => {
    const manifest = manifestSchema.parse(base);
    const other = mergedFor(manifest, "does-not-exist");
    expect(Object.keys(other.services).sort()).toEqual(["api", "web-admin"]);
    expect(Object.keys(other.databases).sort()).toEqual(["postgres", "postgres-prod"]);
  });

  // The base map is what an unscoped resolve returns, and it must still list
  // everything: `null` scopes a resource out of ONE environment, it does not
  // delete it from the project.
  it("does not mutate the base manifest", () => {
    const manifest = manifestSchema.parse(base);
    mergedFor(manifest, "staging");
    expect(Object.keys(manifest.databases).sort()).toEqual(["postgres", "postgres-prod"]);
  });
});
