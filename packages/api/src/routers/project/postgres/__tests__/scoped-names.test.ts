/**
 * od-jwx: a non-main environment gets its own container, volume and hostname.
 *
 * Before this, all three derived from {engine, projectSlug, resourceName} with
 * no environment in them. The hostname is the one that BLOCKED: it has no
 * environment and `database_resource_internal_hostname_unique` is global, so a
 * staging `postgres` failed at INSERT beside production's — the container and
 * volume collision could never even be reached.
 *
 * The safety property is the base case. `resolveRuntimeScope` returns BASE for
 * main and for unstamped rows, so the suffix is empty and every already-
 * deployed database keeps the exact identity it has. These pin that.
 */
import { describe, expect, it } from "vite-plus/test";

import { deriveInternalDbCredentials } from "../credentials";

const base = {
  engine: "postgres" as const,
  projectSlug: "shared",
  resourceName: "postgres",
  password: "pw",
};

describe("scoped database identity", () => {
  it("is byte-identical to today when the scope is base", () => {
    const without = deriveInternalDbCredentials(base);
    const empty = deriveInternalDbCredentials({ ...base, scopeSuffix: "" });
    expect(empty.internalHostname).toBe(without.internalHostname);
    expect(empty.internalConnectionString).toBe(without.internalConnectionString);
  });

  it("puts the suffix on the host label, not the domain", () => {
    const scoped = deriveInternalDbCredentials({ ...base, scopeSuffix: "-staging" });
    expect(scoped.internalHostname.startsWith("postgres-staging.shared.")).toBe(true);
    expect(scoped.internalHostname).not.toBe(deriveInternalDbCredentials(base).internalHostname);
  });

  it("leaves the database name and username alone", () => {
    // They are already namespaced by project slug, and they are the identity a
    // dump/restore round-trips through: scoping them would rename an existing
    // tenant's schema for no uniqueness gain.
    const scoped = deriveInternalDbCredentials({ ...base, scopeSuffix: "-staging" });
    const plain = deriveInternalDbCredentials(base);
    expect(scoped.databaseName).toBe(plain.databaseName);
    expect(scoped.username).toBe(plain.username);
  });

  it("carries the scoped host into the connection string", () => {
    const scoped = deriveInternalDbCredentials({ ...base, scopeSuffix: "-staging" });
    expect(scoped.internalConnectionString).toContain("postgres-staging.shared.");
  });

  it("ignores the suffix for a tenant on a shared server", () => {
    // A tenant answers on its HOST's hostname, which already carries the host's
    // own scope. Appending a second one would address nothing.
    const tenant = deriveInternalDbCredentials({
      ...base,
      scopeSuffix: "-staging",
      host: { internalHostname: "pg-host.shared.internal", internalPort: 5432 },
    });
    expect(tenant.internalHostname).toBe("pg-host.shared.internal");
  });
});
