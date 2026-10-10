/**
 * A domain write rolls only the containers whose env the new address actually
 * changes, behind the response.
 *
 * `service.domains.add` used to recreate the service's container
 * (redeployAndFanOut) before answering, although nothing in it, or anywhere
 * else, referenced its address. Here the handlers run as shipped against a
 * migrated Postgres with the real env resolver; only the container roll
 * (redeploy.ts) and Caddy's admin API are stood in for, so a test can see which
 * services roll and hold a roll open to prove the response does not wait for
 * it.
 */
import type { OrganizationId, ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const rolls = vi.hoisted(() => {
  /** Every roll asked for, in order. */
  const rolled: string[] = [];
  /** Open while a test holds rolls; they finish when it is released. */
  let gate: Promise<void> = Promise.resolve();
  let release: () => void = () => undefined;
  return {
    rolled,
    hold() {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
    async roll(resourceId: string) {
      rolled.push(resourceId);
      await gate;
    },
  };
});

const runtimeOk = {
  serviceId: "svc",
  serviceName: "svc",
  networkName: "net",
  status: "running" as const,
  health: null,
};

vi.mock("../redeploy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../redeploy")>()),
  redeployOne: async (_projectId: ProjectId, resourceId: ResourceId) => {
    await rolls.roll(resourceId);
    return Result.ok(runtimeOk);
  },
  // The handlers used to roll through this one, unconditionally and awaited.
  redeployAndFanOut: async (_projectId: ProjectId, resourceId: ResourceId) => {
    await rolls.roll(resourceId);
    return Result.ok(runtimeOk);
  },
}));

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
vi.mock("../../../lib/domain-reachability", () => ({
  checkDomainReachability: async () => ({ state: "proxied", addresses: ["104.16.0.1"] }),
}));
vi.mock("../domain-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain-rules")>()),
  isMultiOrgInstall: async () => false,
}));

const { addServiceDomain, removeServiceDomain, setPrimaryServiceDomain } =
  await import("../domains");
const { addressRollsIdle } = await import("../domains-address-roll");
const { createServiceRecord } = await import("../queries/service");
const { upsertServiceEnvVar } = await import("../queries/env");
const { seedOrganization, seedProject, uniq } = await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/domain-address-roll" });

let organizationId: OrganizationId;
let projectId: ProjectId;
let environmentId: Awaited<ReturnType<typeof seedProject>>["mainEnvironmentId"];

async function service(name: string, env: Record<string, string> = {}): Promise<ResourceId> {
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
  for (const [key, value] of Object.entries(env)) {
    await upsertServiceEnvVar({ serviceResourceId: record.resource.id, key, value });
  }
  return record.resource.id;
}

/** Add a host, failing the test if the answer waits on a held roll. */
async function add(resourceId: ResourceId, domain: string): Promise<ProxyRouteId> {
  const answered = await Promise.race([
    addServiceDomain({ organizationId, projectId, resourceId, domain }, log),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
  ]);
  if (!answered) {
    rolls.release();
    throw new Error("the domain add waited on the container roll");
  }
  if (answered.isErr()) throw answered.error;
  return idSchema.proxyRoute.parse(answered.value.id);
}

async function settled(): Promise<string[]> {
  await addressRollsIdle();
  return [...rolls.rolled];
}

beforeAll(async () => {
  organizationId = await seedOrganization("domain-roll");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  environmentId = project.mainEnvironmentId;
});

beforeEach(async () => {
  await settled();
  rolls.release();
  rolls.rolled.length = 0;
});

describe("a domain change and the containers it rolls", () => {
  it("adding a host to a service nothing references answers at once and rolls nothing", async () => {
    const plain = await service(`tools-${uniq()}`);
    // Any roll the handler waits on never finishes, so waiting fails the race.
    rolls.hold();

    await add(plain, `tools-${uniq()}.example.org`);

    rolls.release();
    expect(await settled()).toEqual([]);
  });

  it("a service that reads its own PUBLIC_URL rolls, after the answer", async () => {
    const name = `auth-${uniq()}`;
    const self = await service(name, { BETTER_AUTH_URL: `\${{${name}.PUBLIC_URL}}` });
    rolls.hold();

    await add(self, `auth-${uniq()}.example.org`);
    // The answer came back while the roll is still held open.
    await vi.waitFor(() => expect(rolls.rolled).toEqual([self]));

    rolls.release();
    expect(await settled()).toEqual([self]);
  });

  it("rolls exactly the dependents whose resolved env changed", async () => {
    const apiName = `api-${uniq()}`;
    const api = await service(apiName);
    const web = await service(`web-${uniq()}`, { API_URL: `\${{${apiName}.PUBLIC_URL}}` });
    // References the api, but only its internal address: no domain moves it.
    await service(`worker-${uniq()}`, { API_HOST: `\${{${apiName}.HOST}}` });

    const first = await add(api, `api-${uniq()}.example.org`);
    expect(await settled()).toEqual([web]);

    // A second host leaves the primary, and so PUBLIC_URL, where it was.
    rolls.rolled.length = 0;
    const second = await add(api, `api2-${uniq()}.example.org`);
    expect(await settled()).toEqual([]);

    // Promoting it moves PUBLIC_URL.
    const promoted = await setPrimaryServiceDomain(
      { organizationId, projectId, resourceId: api, routeId: second },
      log,
    );
    expect(promoted.isOk()).toBe(true);
    expect(await settled()).toEqual([web]);

    // Removing the non-primary host changes nothing anyone reads.
    rolls.rolled.length = 0;
    const removed = await removeServiceDomain(
      { organizationId, projectId, resourceId: api, routeId: first },
      log,
    );
    expect(removed.isOk()).toBe(true);
    expect(await settled()).toEqual([]);
  });
});
