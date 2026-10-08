/**
 * od-mc6m: the new-service wizard's generated host must land as the GENERATED
 * route, not as a custom domain that happens to carry the same name.
 *
 * The wizard stages the host `project.resource.publicHostPreview` resolved in
 * the manifest's `domains` whenever a public port has no hostname of its own.
 * Apply used to feed every manifest domain through `addServiceDomain`, which
 * writes `source = 'custom'`, so the Public networking card kept offering
 * "Generate domain" for a service already published at its generated address.
 *
 * Real query modules against a migrated Postgres; only the DNS answer is stood
 * in for (lib/dns-resolver.ts, the one network boundary). Also re-runs the
 * backfill migration over rows the old path wrote, to pin exactly which rows it
 * may touch.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { platformSettings, PLATFORM_SETTINGS_ID } from "@otterdeploy/db/schema/platform";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { eq, sql } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { createServiceRecord } from "../../service/queries/service";
import { seedServiceDomains } from "../manifest-apply-services";
import { previewResourcePublicHost } from "../resources";

vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: no Docker daemon, so anything left reaching for one fails fast instead of dialing a socket */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-seed-generated.sock";
});

const SERVER_IP = "203.0.113.24";

vi.mock("../../../lib/dns-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/dns-resolver")>();
  return {
    ...actual,
    resolveTxtRobust: async (name: string) =>
      Result.err(new actual.DnsRecordMissing({ name, code: "ENOTFOUND", cause: null })),
    // Every name reads as pointed at this server: sslip hosts do by
    // construction, and a typed custom host stays custom either way.
    resolveAddressesRobust: async () => Result.ok([SERVER_IP]),
  };
});

// The Docker API is the other boundary, and a test has none: reconcile
// attaches the edge to project networks through it, the post-add redeploy rolls
// the service through it, and the service view reads live task state from it.
// What is under test is the route row apply writes, not any of those.
vi.mock("../../../caddy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../caddy")>();
  return {
    ...actual,
    reconcile: async () => ({ applied: [], skipped: [], revision: "test" }),
  };
});
vi.mock("../../service/redeploy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../service/redeploy")>();
  return { ...actual, redeployAndFanOut: async () => Result.ok(true) };
});
vi.mock("../../service/get-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../service/get-service")>();
  return { ...actual, getService: async () => Result.ok({ publicDomain: null }) };
});

const log = createRequestLogger({ method: "TEST", path: "/manifest-seed-generated-domain" });

let organizationId: OrganizationId;
let projectId: ProjectId;
let projectSlug: string;
let environmentId: Awaited<ReturnType<typeof seedProject>>["mainEnvironmentId"];
let previousServerIp: string | null = null;

async function createWebService(name: string): Promise<ResourceId> {
  const record = await createServiceRecord({
    projectId,
    environmentId,
    name,
    image: "nginx:alpine",
    internalHostname: name,
    serviceName: `od-${name}`,
    networkName: `od-net-${uniq()}`,
    stackId: null,
    composeService: null,
    ports: [{ containerPort: 8080, appProtocol: "http", isPrimary: true }],
  });
  return record.resource.id;
}

async function routesOf(resourceId: ResourceId) {
  return db
    .select({
      id: proxyRoute.id,
      domain: proxyRoute.domain,
      source: proxyRoute.source,
      isPrimary: proxyRoute.isPrimary,
      enabled: proxyRoute.enabled,
    })
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId));
}

/** What the wizard stages for a public port with no hostname of its own. */
async function wizardHost(name: string): Promise<string> {
  const preview = await previewResourcePublicHost({ organizationId, projectId, name });
  if (preview.isErr()) throw preview.error;
  return preview.value.fqdn;
}

beforeAll(async () => {
  organizationId = await seedOrganization("seed-gen");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  projectSlug = project.slug;
  environmentId = project.mainEnvironmentId;
  const [settings] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  previousServerIp = settings?.serverIp ?? null;
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, serverIp: SERVER_IP })
    .onConflictDoUpdate({ target: platformSettings.id, set: { serverIp: SERVER_IP } });
});

afterAll(async () => {
  await db
    .update(platformSettings)
    .set({ serverIp: previousServerIp })
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
});

describe("seedServiceDomains: the wizard's generated host", () => {
  it("lands as the generated route, the same row Generate domain mints", async () => {
    const name = `web-${uniq()}`;
    const resourceId = await createWebService(name);
    const host = await wizardHost(name);
    expect(host).toBe(`${name}-${projectSlug}.${SERVER_IP}.sslip.io`);

    const skips = await seedServiceDomains({
      projectId,
      organizationId,
      resourceId,
      name,
      domains: [{ domain: host, primary: true }],
      log,
    });

    expect(skips.map((s) => s.message)).toEqual([]);
    const routes = await routesOf(resourceId);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      domain: host,
      source: "generated",
      isPrimary: true,
      enabled: true,
    });
  });

  it("keeps a typed domain custom beside the generated one", async () => {
    const name = `api-${uniq()}`;
    const resourceId = await createWebService(name);
    const host = await wizardHost(name);
    const typed = `${name}.example.org`;

    await seedServiceDomains({
      projectId,
      organizationId,
      resourceId,
      name,
      domains: [{ domain: typed, primary: true }, { domain: host }],
      log,
    });

    const byDomain = new Map((await routesOf(resourceId)).map((r) => [r.domain, r]));
    expect(byDomain.get(typed)).toMatchObject({ source: "custom", isPrimary: true });
    expect(byDomain.get(host)).toMatchObject({ source: "generated", isPrimary: false });
  });

  it("previews the label the mint uses for a project slug longer than 32 characters", async () => {
    const long = await seedProject(organizationId, `p-${uniq()}-${"a".repeat(30)}`);
    const preview = await previewResourcePublicHost({
      organizationId,
      projectId: long.projectId,
      name: "web",
    });
    if (preview.isErr()) throw preview.error;
    expect(preview.value.fqdn).toBe(`web-${long.slug.slice(0, 32)}.${SERVER_IP}.sslip.io`);
  });
});

describe("backfill migration 20261008093000_wizard_generated_route_source", () => {
  const MIGRATION = join(
    import.meta.dirname,
    "../../../../../db/src/migrations/20261008093000_wizard_generated_route_source/migration.sql",
  );

  async function runBackfill(): Promise<void> {
    const statements = readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint");
    for (const statement of statements) await db.execute(sql.raw(statement));
  }

  async function insertRoute(input: {
    resourceId: ResourceId;
    domain: string;
    verified: boolean;
  }): Promise<void> {
    await db.insert(proxyRoute).values({
      projectId,
      resourceId: input.resourceId,
      type: "http",
      domain: input.domain,
      upstreamHost: "od-x",
      upstreamPort: 8080,
      protocol: "http",
      source: "custom",
      domainVerifiedAt: input.verified ? new Date() : null,
    });
  }

  async function sourceOf(domain: string) {
    const [row] = await db
      .select({ source: proxyRoute.source })
      .from(proxyRoute)
      .where(eq(proxyRoute.domain, domain));
    return row?.source;
  }

  it("marks only verified service routes at their own generated sslip host", async () => {
    const name = `Shop_${uniq()}`;
    const resourceId = await createWebService(name);
    const label = name.toLowerCase().replace(/_/g, "-");
    const generated = `${label}-${projectSlug}.198.51.100.7.sslip.io`;
    await insertRoute({ resourceId, domain: generated, verified: true });

    const other = await createWebService(`other-${uniq()}`);
    // Pending ownership (multi-org): left for its owner to verify.
    const pendingName = `pending-${uniq()}`;
    const pending = await createWebService(pendingName);
    const pendingHost = `${pendingName}-${projectSlug}.198.51.100.7.sslip.io`;
    await insertRoute({ resourceId: pending, domain: pendingHost, verified: false });
    // Another resource's generated pattern, on this resource: not its own.
    const foreignHost = `${label}-x-${projectSlug}.198.51.100.7.sslip.io`;
    await insertRoute({ resourceId: other, domain: foreignHost, verified: true });
    // A real domain an operator typed.
    const typed = `${label}.example.org`;
    await insertRoute({ resourceId, domain: typed, verified: true });

    await runBackfill();

    expect(await sourceOf(generated)).toBe("generated");
    expect(await sourceOf(pendingHost)).toBe("custom");
    expect(await sourceOf(foreignHost)).toBe("custom");
    expect(await sourceOf(typed)).toBe("custom");
  });
});
