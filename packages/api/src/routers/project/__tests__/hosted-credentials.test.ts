/**
 * What a database's connection details become when it lives inside a shared
 * server.
 *
 * The invariant: its IDENTITY stays its own (database name, user, password —
 * which is what keeps two tenants on one server apart) while its ADDRESS
 * becomes the host's. Getting that backwards in either direction is silent:
 * the row still validates, the wizard still renders, and the service just
 * connects to the wrong place.
 */
import { describe, expect, test } from "vite-plus/test";

import { deriveInternalDbCredentials } from "../postgres/credentials";

const host = { internalHostname: "pg.acme.otter.internal", internalPort: 5432 };

describe("hosted database credentials", () => {
  test("keeps its own database + user, takes the host's address", () => {
    const own = deriveInternalDbCredentials({
      engine: "postgres",
      projectSlug: "acme",
      resourceName: "blog",
      password: "pw",
    });
    const hosted = deriveInternalDbCredentials({
      engine: "postgres",
      projectSlug: "acme",
      resourceName: "blog",
      password: "pw",
      host,
    });

    expect(hosted.databaseName).toBe(own.databaseName);
    expect(hosted.username).toBe(own.username);
    expect(hosted.internalHostname).toBe("pg.acme.otter.internal");
    expect(hosted.internalConnectionString).toContain("@pg.acme.otter.internal:5432/");
    expect(hosted.internalConnectionString).toContain(hosted.databaseName);
  });

  test("two tenants of one server never collide: names carry the project", () => {
    // This is why a shared server needs no extra namespacing — the derivation
    // was already `<project>_<resource>_db`, and project slugs are unique.
    const a = deriveInternalDbCredentials({
      engine: "postgres",
      projectSlug: "acme",
      resourceName: "app",
      password: "pw",
      host,
    });
    const b = deriveInternalDbCredentials({
      engine: "postgres",
      projectSlug: "other",
      resourceName: "app",
      password: "pw",
      host,
    });
    expect(a.databaseName).not.toBe(b.databaseName);
    expect(a.username).not.toBe(b.username);
  });

  test("a mongo tenant authenticates against its own database, not admin", () => {
    // The container's root user lives in `admin`, but db.createUser puts a
    // tenant's credential in the tenant's database: authenticating against
    // admin would fail with a valid-looking URL.
    const hosted = deriveInternalDbCredentials({
      engine: "mongodb",
      projectSlug: "acme",
      resourceName: "blog",
      password: "pw",
      host: { internalHostname: "mongo.acme.otter.internal", internalPort: 27017 },
    });
    expect(hosted.internalConnectionString).toContain(`authSource=${hosted.databaseName}`);

    const dedicated = deriveInternalDbCredentials({
      engine: "mongodb",
      projectSlug: "acme",
      resourceName: "blog",
      password: "pw",
    });
    expect(dedicated.internalConnectionString).toContain("authSource=admin");
  });

  test("a dedicated database is untouched by the feature existing", () => {
    const dedicated = deriveInternalDbCredentials({
      engine: "postgres",
      projectSlug: "acme",
      resourceName: "blog",
      password: "pw",
    });
    expect(dedicated.internalHostname).toBe("blog.acme.otterdeploy.internal");
    expect(dedicated.internalPort).toBe(5432);
  });
});
