/**
 * `listGeneratedHostnamesUnder`: the hostnames the change-domain dialog says
 * keep their names. Its bug would live in the query (a missing tenant
 * predicate, a suffix match that takes a lookalike domain, an unescaped LIKE
 * wildcard), so it runs against a real migrated database.
 */
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { listGeneratedHostnamesUnder } from "../queries";

let orgA: OrganizationId;
let orgB: OrganizationId;
let projectA: ProjectId;
let projectB: ProjectId;
// One base per run: the files share a database, and proxy_route.domain is
// unique install-wide.
const base = `acme-${uniq()}.com`;

async function route(
  projectId: ProjectId,
  domain: string,
  options: { source?: "generated" | "custom"; enabled?: boolean } = {},
): Promise<void> {
  await db.insert(proxyRoute).values({
    projectId,
    type: "http",
    domain,
    upstreamHost: "web",
    upstreamPort: 3000,
    protocol: "http",
    source: options.source ?? "generated",
    enabled: options.enabled ?? true,
  });
}

beforeAll(async () => {
  orgA = await seedOrganization("hosts-a");
  orgB = await seedOrganization("hosts-b");
  projectA = (await seedProject(orgA)).projectId;
  projectB = (await seedProject(orgB)).projectId;

  await route(projectA, `web-shop.${base}`);
  await route(projectA, `api-shop.${base}`);
  // Not "already exposed under the base domain", each for a different reason:
  await route(projectA, `www.${base}`, { source: "custom" }); // the operator's own host
  await route(projectA, `old-shop.${base}`, { enabled: false }); // not serving
  await route(projectA, `web-shop.not${base}`); // lookalike domain, no dot boundary
  await route(projectA, `web-shop.${base}.evil.test`); // base as a prefix, not a suffix
  await route(projectA, `web-shop.${base.replace("-", "_")}`); // "_" must not match "-"
  await route(projectB, `web-other.${base}`); // another organization's
});

describe("listGeneratedHostnamesUnder", () => {
  it("returns this org's serving generated hosts under the base, alphabetically", async () => {
    const found = await listGeneratedHostnamesUnder(orgA, base, 50);
    expect(found).toEqual({
      hostnames: [`api-shop.${base}`, `web-shop.${base}`],
      total: 2,
    });
  });

  it("never returns another organization's hosts", async () => {
    const found = await listGeneratedHostnamesUnder(orgB, base, 50);
    expect(found).toEqual({ hostnames: [`web-other.${base}`], total: 1 });
  });

  it("treats LIKE wildcards in the base domain literally", async () => {
    // Unescaped, "acme_<x>.com" would match "acme-<x>.com" through `_`.
    const found = await listGeneratedHostnamesUnder(orgA, base.replace("-", "_"), 50);
    expect(found).toEqual({ hostnames: [`web-shop.${base.replace("-", "_")}`], total: 1 });
  });

  it("caps the list but still counts every host", async () => {
    const found = await listGeneratedHostnamesUnder(orgA, base, 1);
    expect(found).toEqual({ hostnames: [`api-shop.${base}`], total: 2 });
  });

  it("matches the base domain case-insensitively", async () => {
    const found = await listGeneratedHostnamesUnder(orgA, base.toUpperCase(), 50);
    expect(found.total).toBe(2);
  });
});
