/**
 * A stack's exposure seed that failed is retried, not dropped.
 *
 * The seed applied only on a child's create. When that one expose failed (the
 * child came up with no port, the host was taken, a DB blip), the failure was
 * a deploy-log line, the stack read `running`, and no later deploy tried
 * again: the operator had to add a port and expose the child by hand. The
 * entry is now marked `seedPending` and every later deploy retries it until it
 * lands; a landed seed, or a child the operator published by hand, is never
 * touched again.
 *
 * Real query modules and the real `exposeService` against a migrated
 * Postgres. Only the network boundaries are stood in for: DNS (every name
 * reads as pointed here) and the edge reload (nothing to load into).
 */
import type { ComposeExposed } from "@otterdeploy/shared/compose";
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { listServicePorts } from "../../service/queries";
import { createComposeRecord, getComposeRecord } from "../queries";
import { seedServiceExposure, type RolloutContext } from "../reconcile-rollout";

vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: nothing here may dial a Docker daemon */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-seed-expose-retry.sock";
});

const SERVER_IP = "203.0.113.31";

vi.mock("../../../lib/dns-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/dns-resolver")>();
  return {
    ...actual,
    resolveTxtRobust: async (name: string) =>
      Result.err(new actual.DnsRecordMissing({ name, code: "ENOTFOUND", cause: null })),
    resolveAddressesRobust: async () => Result.ok([SERVER_IP]),
  };
});
// There is no edge to load here: the reconcile the expose runs is a no-op.
vi.mock("../../../caddy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../caddy")>()),
  reconcile: async () => ({ applied: [], skipped: [], revision: "test" }),
}));
vi.mock("../../service/get-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../service/get-service")>()),
  getService: async () => Result.ok({ publicDomain: null }),
}));

const log = createRequestLogger({ method: "TEST", path: "/compose/seed-expose-retry" });

let organizationId: OrganizationId;
let projectId: ProjectId;
let projectSlug: string;
let environmentId: Awaited<ReturnType<typeof seedProject>>["mainEnvironmentId"];
let previousServerIp: string | null = null;

beforeAll(async () => {
  organizationId = await seedOrganization("seed-retry");
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

/** A stack exposing `app:3000`, and its `app` child created with NO port:
 *  how a stack whose file declared no `ports:` came up before the seed's
 *  port reached the child, so its expose failed. */
async function seedStack(): Promise<{ stackId: ResourceId; appId: ResourceId }> {
  const stack = await createComposeRecord({
    projectId,
    environmentId,
    name: `stack-${uniq()}`,
    source: "inline",
    composeContent: "services:\n  app:\n    image: nginx:alpine\n",
    stackName: `stack-${uniq()}`,
    services: [],
    exposed: [{ service: "app", port: 3000, domain: "" }],
  });
  const app = await seedService({
    projectId,
    environmentId,
    name: `app-${uniq()}`,
    stackId: stack.resource.id,
    composeService: "app",
  });
  return { stackId: stack.resource.id, appId: app.resourceId };
}

/** The context a stack deploy builds: the seeds as the row holds them now. */
async function deployContext(stackId: ResourceId): Promise<RolloutContext> {
  const record = await getComposeRecord(projectId, stackId);
  if (!record) throw new Error("stack vanished");
  return {
    projectId,
    organizationId,
    projectSlug,
    stackResourceId: stackId,
    exposedSeeds: new Map(record.compose.exposed.map((e) => [e.service, e])),
  };
}

async function seedOf(stackId: ResourceId): Promise<ComposeExposed | undefined> {
  return (await getComposeRecord(projectId, stackId))?.compose.exposed[0];
}

async function routesOf(resourceId: ResourceId) {
  return db
    .select({ id: proxyRoute.id, enabled: proxyRoute.enabled })
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId));
}

async function seed(stackId: ResourceId, appId: ResourceId, isCreate: boolean) {
  const lines: string[] = [];
  const ctx = await deployContext(stackId);
  await seedServiceExposure(ctx, isCreate, "app", appId, {}, log, (l) => lines.push(l));
  return lines;
}

describe("A failed stack exposure seed", () => {
  it("is marked pending, then lands on the next deploy (with the seed's port)", async () => {
    const { stackId, appId } = await seedStack();

    const first = await seed(stackId, appId, true);
    expect(first.join("\n")).toMatch(/seed expose failed/);
    expect(await routesOf(appId)).toEqual([]);
    expect((await seedOf(stackId))?.seedPending).toBe(true);

    // The next deploy of the stack: the child already exists.
    const second = await seed(stackId, appId, false);
    expect(second.join("\n")).toMatch(/exposed publicly at/);
    expect((await routesOf(appId)).length).toBe(1);
    const ports = await listServicePorts(appId);
    expect(ports.map((p) => [p.containerPort, p.appProtocol, p.isPrimary])).toEqual([
      [3000, "http", true],
    ]);
    // Landed: the mark is gone, so no later deploy re-fires it.
    expect((await seedOf(stackId))?.seedPending).toBeUndefined();
  });

  it("does not re-fire a landed seed on a later deploy", async () => {
    const { stackId, appId } = await seedStack();
    await seed(stackId, appId, true);
    await seed(stackId, appId, false);
    // The operator unpublishes the child: its routes are disabled, kept.
    await db.update(proxyRoute).set({ enabled: false }).where(eq(proxyRoute.resourceId, appId));

    expect(await seed(stackId, appId, false)).toEqual([]);
    expect((await routesOf(appId)).every((r) => !r.enabled)).toBe(true);
  });

  it("leaves a child the operator published by hand alone, and clears the mark", async () => {
    const { stackId, appId } = await seedStack();
    await seed(stackId, appId, true);
    expect((await seedOf(stackId))?.seedPending).toBe(true);
    // Published by hand meanwhile, then unpublished: routes exist, disabled.
    await db.insert(proxyRoute).values({
      projectId,
      resourceId: appId,
      type: "http",
      domain: `by-hand-${uniq()}.example.org`,
      upstreamHost: "unused",
      upstreamPort: 3000,
      protocol: "http",
      enabled: false,
    });

    expect(await seed(stackId, appId, false)).toEqual([]);
    expect((await routesOf(appId)).every((r) => !r.enabled)).toBe(true);
    expect((await seedOf(stackId))?.seedPending).toBeUndefined();
  });
});
