import { describe, expect, it } from "vite-plus/test";

import type { Change } from "../../../stack/manifest";

import { groupChanges } from "../manifest-apply-support";

const envChange = (
  parent: "service" | "database",
  owner: string,
  key: string,
  kind: Change["kind"] = "delete",
): Change => ({
  kind,
  resource: "env",
  name: `${owner}.${key}`,
  details: { parent, key, owner },
});

describe("groupChanges", () => {
  it("synthesizes a service update for an env-only diff", () => {
    // THE dealort bug: a diff of nothing but env changes planned N items and
    // applied zero — no service/database change meant no phase ran, so the
    // pending bar never cleared no matter how many times Apply was clicked.
    const grouped = groupChanges([
      envChange("service", "dealort", "ARCJET_KEY"),
      envChange("service", "dealort", "DATABASE_URL"),
    ]);
    expect(grouped.serviceUpdates).toEqual([
      { kind: "update", resource: "service", name: "dealort", details: { envOnly: true } },
    ]);
  });

  it("synthesizes a database update for an extraEnv-only diff", () => {
    const grouped = groupChanges([envChange("database", "primary", "TZ", "update")]);
    expect(grouped.databaseUpdates).toEqual([
      { kind: "update", resource: "database", name: "primary", details: { envOnly: true } },
    ]);
  });

  it("does not synthesize when the owner already has an update", () => {
    const real: Change = { kind: "update", resource: "service", name: "web", details: {} };
    const grouped = groupChanges([real, envChange("service", "web", "A")]);
    expect(grouped.serviceUpdates).toEqual([real]);
  });

  it("does not synthesize when the owner is being created or deleted", () => {
    const create: Change = { kind: "create", resource: "service", name: "web" };
    const del: Change = { kind: "delete", resource: "service", name: "old" };
    const grouped = groupChanges([
      create,
      del,
      envChange("service", "web", "A", "create"),
      envChange("service", "old", "B"),
    ]);
    expect(grouped.serviceUpdates).toEqual([]);
    expect(grouped.serviceCreates).toEqual([create]);
    expect(grouped.serviceDeletes).toEqual([del]);
  });

  it("synthesizes one update per owner across many env changes", () => {
    const grouped = groupChanges([
      envChange("service", "a", "X"),
      envChange("service", "a", "Y"),
      envChange("service", "b", "Z", "create"),
    ]);
    expect(grouped.serviceUpdates.map((c) => c.name)).toEqual(["a", "b"]);
  });
});
