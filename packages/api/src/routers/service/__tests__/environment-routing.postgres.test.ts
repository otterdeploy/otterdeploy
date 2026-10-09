/**
 * A service's hosts reach the container of the environment it lives in, a
 * private environment's hosts are gated, and "Generate domain" mints the
 * platform's host beside a primary custom one.
 *
 * `service_resource.service_name` is the base name a production and a staging
 * `web` share; the deploy path runs a non-main environment as
 * `<base>-<env>`. Route writes, the delete teardown and the status read now
 * use that runtime name. A private environment's routes are gated by the
 * authorizer as well as the edge. Generate domain no longer resolves the
 * "generated" host through the `publicDomain` mirror of a primary custom
 * domain.
 *
 * The handlers run as shipped against a migrated Postgres. Only the edge's
 * admin API, DNS, and the container runtime are stood in for.
 */
import type { EnvironmentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

const runtimeCalls = vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: host-artifact reclaim must fail fast on an unreachable Docker */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-environment-routing.sock";
  return { destroyed: new Array<string>() };
});

vi.mock("../../../caddy/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../caddy/client")>()),
  adaptCaddyfile: async () => ({ ok: true, json: {} }),
  loadCaddyfile: async () => ({ ok: true }),
  readCaddyConfig: async () => Result.err(new Error("no admin API in this test")),
}));

vi.mock("../../../swarm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../swarm/client")>()),
  ensureEdgeOnProjectNetworks: async () => undefined,
}));

// Proxied DNS serves at once on a single-org install, on `tls internal`.
vi.mock("../../../lib/domain-reachability", () => ({
  checkDomainReachability: async () => ({ state: "proxied", addresses: ["104.16.0.1"] }),
}));
vi.mock("../domain-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain-rules")>()),
  isMultiOrgInstall: async () => false,
}));

vi.mock("../../../runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../runtime")>();
  const healthy = (spec: { serviceName: string; networkName?: string }) => ({
    serviceId: `id-${spec.serviceName}`,
    serviceName: spec.serviceName,
    networkName: spec.networkName ?? "net",
    status: "running" as const,
    health: null,
  });
  const driver = {
    ...actual.runtime(),
    provision: async (spec: { serviceName: string; networkName: string }) => healthy(spec),
    update: async (spec: { serviceName: string; networkName: string }) => healthy(spec),
    destroy: async (spec: { serviceName: string }) => {
      runtimeCalls.destroyed.push(spec.serviceName);
    },
    inspect: async (input: { serviceName: string }) => healthy(input),
    inspectMany: async (inputs: ReadonlyArray<{ serviceName: string }>) =>
      new Map(inputs.map((i) => [i.serviceName, healthy(i)])),
  };
  return { ...actual, runtime: () => driver };
});

const { resolveProtectedDomainOrg } = await import("../../../authz/membership");
const { setEnvProtection } = await import("../../env/handlers");
const { addServiceDomain } = await import("../domains");
const { generateServiceDomain } = await import("../expose");
const { deleteService } = await import("../handlers");
const { createServiceRecord } = await import("../queries/service");
const { seedEnvironment, seedOrganization, seedProject, uniq } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/environment-routing" });

let organizationId: OrganizationId;
let projectId: ProjectId;
let mainId: EnvironmentId;
let stagingId: EnvironmentId;
/** The stored service name both environments' `web` share. */
let base: string;
let prodWeb: ResourceId;
let stagingWeb: ResourceId;

async function createWeb(environmentId: EnvironmentId, name: string, serviceName: string) {
  const record = await createServiceRecord({
    projectId,
    environmentId,
    name,
    image: "nginx:alpine",
    internalHostname: name,
    serviceName,
    networkName: `od-net-${uniq()}`,
    stackId: null,
    composeService: null,
    ports: [{ containerPort: 8080, appProtocol: "http", isPrimary: true }],
  });
  return record.resource.id;
}

async function routesOf(resourceId: ResourceId) {
  return db.select().from(proxyRoute).where(eq(proxyRoute.resourceId, resourceId));
}

async function add(resourceId: ResourceId, domain: string) {
  const added = await addServiceDomain({ organizationId, projectId, resourceId, domain }, log);
  if (added.isErr()) throw added.error;
  return added.value;
}

async function generate(resourceId: ResourceId) {
  const generated = await generateServiceDomain({ organizationId, projectId, resourceId }, log);
  if (generated.isErr()) throw generated.error;
  return generated.value;
}

beforeAll(async () => {
  organizationId = await seedOrganization("env-routing");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  mainId = project.mainEnvironmentId;
  stagingId = await seedEnvironment(projectId, "staging");
  base = `od-${project.slug}-web`;
  // The same name in both environments: legal.
  prodWeb = await createWeb(mainId, "web", base);
  stagingWeb = await createWeb(stagingId, "web", base);
});

describe("a service's hosts reach its own environment's container", () => {
  it("routes a staging custom domain to staging's container, production's to production's", async () => {
    const staging = await add(stagingWeb, `staging-${uniq()}.example.org`);
    const production = await add(prodWeb, `app-${uniq()}.example.org`);

    const [stagingRoute] = (await routesOf(stagingWeb)).filter((r) => r.id === staging.id);
    const [productionRoute] = (await routesOf(prodWeb)).filter((r) => r.id === production.id);
    // The runtime name the deploy path gives each (spec.ts → runtimeServiceName).
    expect(stagingRoute?.upstreamHost).toBe(`${base}-staging`);
    expect(productionRoute?.upstreamHost).toBe(base);
  });

  it("mints staging's generated host under its own label, dialing staging", async () => {
    const staging = await generate(stagingWeb);
    const production = await generate(prodWeb);

    expect(staging.domain).not.toBe(production.domain);
    expect(staging.domain.startsWith("web-staging-")).toBe(true);
    const stagingRoute = (await routesOf(stagingWeb)).find((r) => r.domain === staging.domain);
    expect(stagingRoute?.upstreamHost).toBe(`${base}-staging`);
    expect(stagingRoute?.source).toBe("generated");
  });

  it("gates every host of a private environment, and only that environment's", async () => {
    const stagingHosts = (await routesOf(stagingWeb)).map((r) => r.domain);
    const productionHosts = (await routesOf(prodWeb)).map((r) => r.domain);
    expect(stagingHosts.length).toBeGreaterThan(0);

    const set = await setEnvProtection({ id: stagingId, protected: true, organizationId });
    expect(set.isOk()).toBe(true);

    for (const host of stagingHosts) {
      // The authorizer forward_auth asks. Null means "no gate, allow through".
      const gate = await resolveProtectedDomainOrg(host);
      expect(gate?.orgId, `${host} answered without a wall`).toBe(organizationId);
    }
    for (const host of productionHosts) {
      expect(await resolveProtectedDomainOrg(host)).toBeNull();
    }

    // Public again: each route falls back to its own switch, which is off.
    await setEnvProtection({ id: stagingId, protected: false, organizationId });
    for (const host of stagingHosts) {
      expect(await resolveProtectedDomainOrg(host)).toBeNull();
    }
  });

  it("deleting staging's service destroys staging's container, never production's", async () => {
    runtimeCalls.destroyed.length = 0;
    const deleted = await deleteService({ organizationId, projectId, resourceId: stagingWeb }, log);
    expect(deleted.isOk()).toBe(true);
    expect(runtimeCalls.destroyed).toEqual([`${base}-staging`]);
  });
});

describe("Generate domain beside a primary custom domain", () => {
  it("mints the platform's host instead of answering with the custom one", async () => {
    const api = await createWeb(mainId, "api", `od-api-${uniq()}`);
    const custom = `secure-${uniq()}.example.org`;
    const added = await addServiceDomain(
      { organizationId, projectId, resourceId: api, domain: custom },
      log,
    );
    if (added.isErr()) throw added.error;
    expect(added.value.isPrimary).toBe(true);

    const generated = await generate(api);
    expect(generated.domain).not.toBe(custom);
    const routes = await routesOf(api);
    expect(routes.map((r) => r.domain).toSorted()).toEqual([custom, generated.domain].toSorted());
    expect(routes.find((r) => r.domain === generated.domain)?.source).toBe("generated");
    // The custom domain keeps primary: generating does not take it over.
    expect(routes.find((r) => r.domain === custom)?.isPrimary).toBe(true);
  });
});
