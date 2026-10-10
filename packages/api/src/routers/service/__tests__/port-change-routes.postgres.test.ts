/**
 * Against a migrated Postgres: a live, exposed service's port change moves its
 * routes.
 *
 * `updateService` saved the new ports and rolled the container, but only
 * `exposeService` ever rewrote `proxy_route.upstreamPort`, so after a port
 * change (3000 -> 8080) Caddy kept dialing :3000 while the container listened
 * on :8080 until someone re-ran expose. The routes now follow the primary port
 * when the roll that carries it lands: at once for a change rolled now, and at
 * the build's roll for one that rides a build.
 *
 * The handlers and the edge reconcile run as shipped. Only the container
 * runtime (it records each rollout and comes up healthy) and the edge's admin
 * API (it records each /load) are stood in for.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const edge = vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: nothing here may dial a Docker daemon */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-port-change-routes.sock";
  /** Every config handed to Caddy's /load, in order. */
  return { loads: new Array<string>() };
});

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
    destroy: async () => undefined,
    inspect: async (input: { serviceName: string }) => healthy(input),
    inspectMany: async (inputs: ReadonlyArray<{ serviceName: string }>) =>
      new Map(inputs.map((i) => [i.serviceName, healthy(i)])),
  };
  return { ...actual, runtime: () => driver };
});

vi.mock("../../../caddy/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../caddy/client")>()),
  adaptCaddyfile: async () => ({ ok: true, json: {} }),
  loadCaddyfile: async (caddyfile: string) => {
    edge.loads.push(caddyfile);
    return { ok: true };
  },
  readCaddyConfig: async () => Result.err(new Error("no admin API in this test")),
}));

// Plain docker: the reconcile re-attaches the edge to project networks first.
// There is no Docker here, and that step is not what is under test.
vi.mock("../../../swarm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../swarm/client")>()),
  ensureEdgeOnProjectNetworks: async () => undefined,
}));

const { updateService } = await import("../handlers");
const { rolloutDispatch } = await import("../rollout");
const { redeployOne } = await import("../redeploy");
const { createServiceRecord } = await import("../queries/service");
const { seedOrganization, seedProject, uniq } = await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/port-change-routes" });

// A service's rollout runs off the request. Nothing consumes a
// queue here, so it runs in-process at once instead of after the queue's ready
// budget runs out on the unreachable test Redis.
rolloutDispatch.enqueue = async () => {
  throw new Error("no service.rollout worker in this test");
};

let organizationId: OrganizationId;
let projectId: ProjectId;
let slug: string;
let resourceId: ResourceId;
let serviceName: string;

async function routeUpstreams() {
  const rows = await db
    .select({ port: proxyRoute.upstreamPort })
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId));
  return rows;
}

const httpPort = (containerPort: number) => [
  { containerPort, appProtocol: "http" as const, isPrimary: true },
];

beforeAll(async () => {
  organizationId = await seedOrganization("port-routes");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  slug = project.slug;
  const name = `web-${uniq()}`;
  serviceName = `od-${name}`;
  const record = await createServiceRecord({
    projectId,
    environmentId: project.mainEnvironmentId,
    name,
    image: "nginx:alpine",
    internalHostname: name,
    serviceName,
    networkName: `od-net-${uniq()}`,
    stackId: null,
    composeService: null,
    ports: httpPort(3000),
  });
  resourceId = record.resource.id;
  // Exposed at :3000, the way exposeService leaves it.
  await db.insert(proxyRoute).values({
    projectId,
    resourceId,
    type: "http",
    domain: `web-${uniq()}.example.org`,
    upstreamHost: serviceName,
    upstreamPort: 3000,
    protocol: "http",
    isPrimary: true,
  });
});

beforeEach(() => {
  edge.loads.length = 0;
});

describe("a port change on an exposed service", () => {
  it("moves the routes to the new port once the roll lands, and reloads the edge", async () => {
    const updated = await updateService(
      { organizationId, projectId, resourceId, ports: httpPort(8080) },
      log,
    );
    if (updated.isErr()) throw updated.error;

    // The roll runs after the answer; the routes follow when it lands.
    await vi.waitFor(async () =>
      expect((await routeUpstreams()).map((r) => r.port)).toEqual([8080]),
    );
    await vi.waitFor(() =>
      expect(edge.loads.some((c) => c.includes(`${serviceName}:8080`))).toBe(true),
    );
    expect(edge.loads.some((c) => c.includes(`${serviceName}:8080`))).toBe(true);
    expect(edge.loads.at(-1)).not.toContain(`${serviceName}:3000`);
  });

  it("leaves the routes on the running port until the build's roll carries the new one", async () => {
    const saved = await updateService(
      { organizationId, projectId, resourceId, ports: httpPort(9090) },
      log,
      "with-build",
    );
    if (saved.isErr()) throw saved.error;
    // Nothing rolled yet: the container still listens on 8080.
    expect((await routeUpstreams()).map((r) => r.port)).toEqual([8080]);

    // The build's deployment rolls the new image onto the saved port.
    const rolled = await redeployOne(projectId, resourceId, slug, log);
    if (rolled.isErr()) throw rolled.error;
    expect((await routeUpstreams()).map((r) => r.port)).toEqual([9090]);
  });

  it("does not touch the routes or reload the edge on a roll that changed no port", async () => {
    const [before] = await db
      .select({ updatedAt: proxyRoute.updatedAt })
      .from(proxyRoute)
      .where(eq(proxyRoute.resourceId, resourceId));
    const rolled = await redeployOne(projectId, resourceId, slug, log);
    if (rolled.isErr()) throw rolled.error;
    const [after] = await db
      .select({ updatedAt: proxyRoute.updatedAt })
      .from(proxyRoute)
      .where(eq(proxyRoute.resourceId, resourceId));
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(edge.loads).toEqual([]);
  });
});
