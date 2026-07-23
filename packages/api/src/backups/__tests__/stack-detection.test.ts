/**
 * Image → engine detection for compose-stack database backups. This is the
 * declarative allow-list that decides which stack services are dumpable — it
 * must match real database images (across registries/tags) and, crucially, NOT
 * misfire on app images that merely contain a DB name (nocodb, postgrest, …).
 */
import { describe, expect, it } from "vite-plus/test";

import { engineFromImage } from "../stack";

describe("engineFromImage", () => {
  it("maps recognised database images to their engine", () => {
    expect(engineFromImage("postgres:16")).toBe("postgres");
    expect(engineFromImage("postgres")).toBe("postgres");
    expect(engineFromImage("ghcr.io/acme/mariadb:11")).toBe("mariadb");
    expect(engineFromImage("mysql:8")).toBe("mariadb"); // mysqldump-compatible
    expect(engineFromImage("mongo:7")).toBe("mongodb");
    expect(engineFromImage("redis:7-alpine")).toBe("redis");
    expect(engineFromImage("valkey/valkey:8")).toBe("redis");
  });

  it("strips a registry PORT without mistaking it for a tag", () => {
    expect(engineFromImage("registry.local:5000/postgres:15")).toBe("postgres");
    expect(engineFromImage("registry.local:5000/mysql")).toBe("mariadb");
  });

  it("ignores a digest", () => {
    expect(engineFromImage("postgres@sha256:abc123")).toBe("postgres");
  });

  it("does NOT misfire on app images that merely contain a DB name", () => {
    // The exact false-positive class Coolify maintains an exclusion list for —
    // our exact-base-name allow-list rejects them for free.
    expect(engineFromImage("nocodb/nocodb:latest")).toBeNull();
    expect(engineFromImage("postgrest/postgrest")).toBeNull();
    expect(engineFromImage("supertokens/supertokens-postgresql")).toBeNull();
    expect(engineFromImage("metabase/metabase")).toBeNull();
    expect(engineFromImage("nginx")).toBeNull();
  });
});
