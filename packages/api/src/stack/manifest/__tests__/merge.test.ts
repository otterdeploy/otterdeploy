import { describe, expect, it } from "vitest";

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
    expect((merged.services.web as { ports: unknown[] }).ports).toEqual([
      { container: 8080 },
    ]);
  });

  it("deletes keys when override value is null", () => {
    const m = {
      ...base(),
      environments: {
        production: {
          services: { web: { env: { LOG_LEVEL: null as unknown as string } } },
        },
      },
    } as unknown as Manifest;
    const merged = resolveEnvironment(m, "production");
    expect((merged.services.web as { env: Record<string, string> }).env).not.toHaveProperty(
      "LOG_LEVEL",
    );
    expect((merged.services.web as { env: Record<string, string> }).env.DATABASE_URL).toBe(
      "${database:primary.url}",
    );
  });

  it("replaces the whole block on discriminator change (image → git)", () => {
    const m = {
      ...base(),
      environments: {
        preview: {
          services: { web: { source: "git", sourceSubdir: "." } },
        },
      },
    } as unknown as Manifest;
    const merged = resolveEnvironment(m, "preview");
    const web = merged.services.web as Record<string, unknown>;
    expect(web).toEqual({ source: "git", sourceSubdir: "." });
    expect(web.image).toBeUndefined();
    expect(web.replicas).toBeUndefined();
  });

  it("removes a database entirely via null override", () => {
    const m = {
      ...base(),
      environments: {
        local: {
          databases: { primary: null as unknown as Record<string, unknown> },
        },
      },
    } as unknown as Manifest;
    const merged = resolveEnvironment(m, "local");
    expect(merged.databases.primary).toBeUndefined();
  });
});
