import { describe, expect, it } from "bun:test";

import { databaseDataMount } from "./database-engines";

describe("databaseDataMount", () => {
  it("mounts postgres 18 and later at the parent of the versioned PGDATA", () => {
    expect(databaseDataMount("postgres", "postgres:18-alpine")).toBe("/var/lib/postgresql");
    expect(databaseDataMount("postgres", "postgres:19")).toBe("/var/lib/postgresql");
  });

  it("keeps the .../data mount through postgres 17 and for extension images", () => {
    expect(databaseDataMount("postgres", "postgres:17-alpine")).toBe("/var/lib/postgresql/data");
    expect(databaseDataMount("postgres", "pgvector/pgvector:pg17")).toBe(
      "/var/lib/postgresql/data",
    );
  });

  it("reads the tag, not a registry port", () => {
    expect(databaseDataMount("postgres", "registry.local:5000/postgres")).toBe(
      "/var/lib/postgresql/data",
    );
  });

  it("uses the catalog's data dir for every other engine", () => {
    expect(databaseDataMount("redis", "redis:8-alpine")).toBe("/data");
    expect(databaseDataMount("mongodb", "mongo:8")).toBe("/data/db");
  });
});
