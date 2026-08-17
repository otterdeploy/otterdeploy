import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironment } from "../merge";
import { manifestSchema, type Manifest } from "../schema";

function base(): Manifest {
  return manifestSchema.parse({
    project: "acme-api",
    services: {
      web: {
        source: "image",
        image: "ghcr.io/acme/api:1.0.0",
        replicas: 1,
        env: { LOG_LEVEL: "info", DATABASE_URL: "${database:primary.url}" },
      },
    },
    databases: {
      primary: { engine: "postgres", version: "16" },
    },
  });
}

describe("resolveEnvironment", () => {
  it("returns the base manifest unchanged when no environment is selected", () => {
    const m = base();
    expect(resolveEnvironment(m)).toEqual(m);
  });

  it("inherits unchanged when the env block is missing", () => {
    const m = base();
    expect(resolveEnvironment(m, "production")).toEqual(m);
  });

  it("deep-merges scalars and objects", () => {
    const m: Manifest = {
      ...base(),
      environments: {
        production: {
          services: { web: { replicas: 3, env: { LOG_LEVEL: "warn" } } },
        },
      },
    };
    const merged = resolveEnvironment(m, "production");
    expect(merged.services.web).toMatchObject({
      source: "image",
      image: "ghcr.io/acme/api:1.0.0",
      replicas: 3,
      env: { LOG_LEVEL: "warn", DATABASE_URL: "${database:primary.url}" },
    });
  });

  it("replaces arrays wholesale", () => {
    const m: Manifest = {
      ...base(),
      services: {
        web: {
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          ports: [{ container: 3000 }, { container: 4000 }],
        },
      },
      environments: {
        production: {
          services: { web: { ports: [{ container: 8080 }] } },
        },
      },
    };
    const merged = resolveEnvironment(m, "production");
    expect(merged.services.web?.ports).toEqual([{ container: 8080 }]);
  });

  it("deletes keys when override value is null", () => {
    // `null` env overrides are merge-time-only syntax the Manifest type can't
    // express (envMap values are strings), so the fixture rides in through
    // Object.assign's intersection rather than a type assertion.
    const m = Object.assign(base(), {
      environments: {
        production: {
          services: { web: { env: { LOG_LEVEL: null } } },
        },
      },
    });
    const merged = resolveEnvironment(m, "production");
    expect(merged.services.web?.env).not.toHaveProperty("LOG_LEVEL");
    expect(merged.services.web?.env?.DATABASE_URL).toBe("${database:primary.url}");
  });

  it("replaces the whole block on discriminator change (image → git)", () => {
    const m: Manifest = {
      ...base(),
      environments: {
        preview: {
          services: { web: { source: "git", sourceSubdir: "." } },
        },
      },
    };
    const merged = resolveEnvironment(m, "preview");
    const web = merged.services.web;
    expect(web).toEqual({ source: "git", sourceSubdir: "." });
    expect(web !== undefined && "image" in web).toBe(false);
    expect(web !== undefined && "replicas" in web).toBe(false);
  });

  it("removes a database entirely via null override", () => {
    // Same story as the null env override above: a null database block is
    // merge-time-only syntax, so no valid Manifest literal can carry it.
    const m = Object.assign(base(), {
      environments: {
        local: {
          databases: { primary: null },
        },
      },
    });
    const merged = resolveEnvironment(m, "local");
    expect(merged.databases.primary).toBeUndefined();
  });
});
