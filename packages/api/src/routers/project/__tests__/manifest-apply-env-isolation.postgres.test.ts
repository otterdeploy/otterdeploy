/**
 * Against a migrated Postgres: applying one environment never touches another
 * environment's resources.
 *
 * A project whose production holds postgres, redis and a compose stack, and a
 * staging environment applying the same manifest. Three things in the apply's
 * create path used to cross the environment boundary:
 *
 *   1. A staging database minted production's public hostname (no environment
 *      in the label) and the global unique index refused the insert.
 *   2. The failed create's rollback re-derived the container name from
 *      (project, name), which carries no environment, and removed
 *      production's container of that name.
 *   3. A compose create stamped the project's MAIN environment whatever was
 *      being applied, so staging's stack collided with production's (or, with
 *      no stack there yet, would have been written into production).
 *
 * Drives `applyManifest` with the real query modules; only the container
 * runtime, the image pull, the boot-log tail, Caddy and the compose rollout
 * are stood in for, and the runtime records every provision and destroy.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  deployment,
  resource,
} from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, inArray } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const runtimeCalls = vi.hoisted(() => ({
  provisioned: new Array<string>(),
  destroyed: new Array<string>(),
  /** When set, every provision throws, to force each create's rollback. */
  failProvision: false,
}));

vi.mock("../../../runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../runtime")>();
  const driver = {
    ...actual.runtime(),
    provisionDatabase: async (spec: { serviceName: string }) => {
      runtimeCalls.provisioned.push(spec.serviceName);
      if (runtimeCalls.failProvision) {
        throw new Error(`provision of ${spec.serviceName} failed (test)`);
      }
      return { status: "running" as const };
    },
    destroyDatabase: async (input: { serviceName: string }) => {
      runtimeCalls.destroyed.push(input.serviceName);
    },
  };
  return { ...actual, runtime: () => driver };
});

vi.mock("../../../swarm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../swarm")>();
  return {
    ...actual,
    resolveRegistryAuth: async () => null,
    // oxlint-disable-next-line require-yield -- an image that is already present: the pull reports nothing
    streamImagePull: async function* () {
      return;
    },
  };
});

vi.mock("../postgres/boot-logs", () => ({
  // oxlint-disable-next-line require-yield -- a container with no boot output to tail
  tailContainerBootLogs: async function* () {
    return;
  },
}));

vi.mock("../../../caddy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../caddy")>();
  return { ...actual, reconcile: async () => ({ applied: [], skipped: [] }) };
});

vi.mock("../../../swarm/resolve-placement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../swarm/resolve-placement")>();
  return { ...actual, resolvePlacementForResource: async () => ({ nodeId: null }) };
});

vi.mock("../../compose/deploy", () => ({
  deployCompose: vi.fn(async () =>
    Result.ok({ status: "running" as const, deployed: 1, failed: [] }),
  ),
  removeComposeDomains: vi.fn(),
}));

vi.mock("../../../lib/escape-hatch", () => ({ writeProjectEscapeHatch: async () => undefined }));

const { seedOrganization, seedProject, seedEnvironment, uniq } =
  await import("../../../__tests__/postgres-seed");
const { applyManifest } = await import("../manifest-apply");
const { manifestSchema } = await import("../../../stack/manifest");
const { createDatabaseResourceRecord } = await import("../queries/postgres-resource");

const log = () => createRequestLogger({ method: "TEST", path: "/manifest/apply" });

const WHOAMI = `services:\n  whoami:\n    image: traefik/whoami:latest\n    ports:\n      - "8080:80"\n`;

/** A small stack: postgres 18, redis 7.4 and a compose stack. */
function stackManifest(slug: string, include: { compose: boolean } = { compose: true }) {
  return manifestSchema.parse({
    project: slug,
    services: {},
    databases: {
      postgres: { engine: "postgres", version: "18" },
      redis: { engine: "redis", version: "7.4" },
    },
    composes: include.compose ? { "edge-probe": { source: "inline", content: WHOAMI } } : {},
  });
}

interface World {
  organizationId: Awaited<ReturnType<typeof seedOrganization>>;
  projectId: ProjectId;
  slug: string;
  production: EnvironmentId;
  staging: EnvironmentId;
}

async function world(label: string): Promise<World> {
  const organizationId = await seedOrganization(label);
  const seeded = await seedProject(organizationId, `tb-${uniq()}`);
  const staging = await seedEnvironment(seeded.projectId, "staging");
  return {
    organizationId,
    projectId: seeded.projectId,
    slug: seeded.slug,
    production: seeded.mainEnvironmentId,
    staging,
  };
}

function apply(w: World, environmentId: EnvironmentId, include?: { compose: boolean }) {
  return applyManifest({
    projectId: w.projectId,
    organizationId: w.organizationId,
    environmentId,
    manifest: stackManifest(w.slug, include),
    log: log(),
  });
}

/** Every resource in one environment, by name. */
async function resourcesIn(w: World, environmentId: EnvironmentId) {
  const rows = await db
    .select({ id: resource.id, name: resource.name, type: resource.type })
    .from(resource)
    .where(and(eq(resource.projectId, w.projectId), eq(resource.environmentId, environmentId)));
  return new Map(rows.map((r) => [r.name, r] as const));
}

/** Every deployment row in the project, whatever environment. */
async function projectDeployments(w: World): Promise<string[]> {
  const rows = await db
    .select({ id: deployment.id, resourceId: deployment.resourceId, reason: deployment.reason })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .where(eq(resource.projectId, w.projectId));
  return rows.map((r) => `${r.resourceId}:${r.id}:${r.reason}`).sort();
}

/** Every deployment row of these resources, as `<resourceId>:<deploymentId>:<reason>`. */
async function deploymentsOf(ids: ResourceId[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: deployment.id, resourceId: deployment.resourceId, reason: deployment.reason })
    .from(deployment)
    .where(inArray(deployment.resourceId, ids));
  return rows.map((r) => `${r.resourceId}:${r.id}:${r.reason}`).sort();
}

async function databaseRow(id: ResourceId) {
  const [row] = await db
    .select({
      serviceName: databaseResource.serviceName,
      publicHostname: databaseResource.publicHostname,
      internalHostname: databaseResource.internalHostname,
    })
    .from(databaseResource)
    .where(eq(databaseResource.resourceId, id));
  if (!row) throw new Error(`no database row for ${id}`);
  return row;
}

/** Production applied and settled: its resources, their deployments, and the
 *  container names the runtime gave its databases. */
async function productionLive(w: World) {
  const applied = await apply(w, w.production);
  expect(applied.skipped).toEqual([]);
  const rows = await resourcesIn(w, w.production);
  const ids = [...rows.values()].map((r) => r.id);
  const pg = rows.get("postgres");
  const redis = rows.get("redis");
  if (!pg || !redis) throw new Error("production databases were not created");
  const containers = [
    (await databaseRow(pg.id)).serviceName,
    (await databaseRow(redis.id)).serviceName,
  ];
  runtimeCalls.provisioned.length = 0;
  runtimeCalls.destroyed.length = 0;
  return { ids, deployments: await deploymentsOf(ids), containers, pgId: pg.id };
}

beforeEach(() => {
  runtimeCalls.provisioned.length = 0;
  runtimeCalls.destroyed.length = 0;
  runtimeCalls.failProvision = false;
});

describe("an environment's apply never touches another environment", () => {
  it("applying staging creates no deploys or restarts for production's resources", async () => {
    const w = await world("iso-a");
    const prod = await productionLive(w);

    await apply(w, w.staging);

    // Production's runtime was never addressed: nothing destroyed, and no
    // provision named one of its containers.
    expect(runtimeCalls.destroyed).toEqual([]);
    for (const name of prod.containers) expect(runtimeCalls.provisioned).not.toContain(name);
    // Its deployment history is exactly what it was: no restart, no create.
    expect(await deploymentsOf(prod.ids)).toEqual(prod.deployments);
  });

  it("same-named resources in two environments both apply cleanly", async () => {
    const w = await world("iso-b");
    const prod = await productionLive(w);

    const staged = await apply(w, w.staging);
    expect(staged.skipped).toEqual([]);
    expect(staged.appliedCount).toBe(3);

    const rows = await resourcesIn(w, w.staging);
    expect(rows.get("postgres")?.type).toBe("database");
    expect(rows.get("redis")?.type).toBe("database");
    // The stack lands in the environment being applied, not production.
    const stack = rows.get("edge-probe");
    expect(stack?.type).toBe("compose");
    if (!stack) return;
    const [compose] = await db
      .select({ stackName: composeResource.stackName })
      .from(composeResource)
      .where(eq(composeResource.resourceId, stack.id));
    expect(compose?.stackName).toMatch(/-staging$/);
    // Production still has exactly its own three, untouched.
    expect((await resourcesIn(w, w.production)).size).toBe(prod.ids.length);

    // Staging's databases have identities of their own.
    const stagingPg = rows.get("postgres");
    if (!stagingPg) return;
    const prodPg = await databaseRow(prod.pgId);
    const stagingRow = await databaseRow(stagingPg.id);
    expect(stagingRow.serviceName).not.toBe(prodPg.serviceName);
    expect(stagingRow.publicHostname).not.toBe(prodPg.publicHostname);
    expect(stagingRow.internalHostname).not.toBe(prodPg.internalHostname);
  });

  it("'created concurrently' does not fire for a same-named resource in another environment", async () => {
    const w = await world("iso-c");
    await productionLive(w);

    const staged = await apply(w, w.staging, { compose: false });
    const reasons = staged.skipped.map((s) => `${s.resource} ${s.name}: ${s.reason}`);
    expect(reasons.filter((r) => /created concurrently|already exists/.test(r))).toEqual([]);
    expect(staged.appliedCount).toBe(2);
  });

  it("a create refused at insert tears nothing down and leaves no deployment", async () => {
    const w = await world("iso-d");
    const prod = await productionLive(w);

    // Something else genuinely holds the hostname staging's postgres needs, so
    // its insert is refused ("created concurrently") before anything runs.
    const prodPg = await databaseRow(prod.pgId);
    const [label, ...rest] = prodPg.publicHostname.split(".");
    const stagingHost = [label?.replace(/^postgres-/, "postgres-staging-"), ...rest].join(".");
    await createDatabaseResourceRecord({
      projectId: w.projectId,
      environmentId: w.production,
      name: `squatter-${uniq()}`,
      engine: "postgres",
      databaseName: "squat",
      username: "squat",
      password: "squat",
      publicHostname: stagingHost,
      publicPort: 443,
      publicConnectionString: "",
      internalHostname: `squat-${uniq()}.otterdeploy.internal`,
      internalPort: 5432,
      internalConnectionString: "",
      upstreamHost: "squat",
      upstreamPort: 5432,
      caddyLayer4Snippet: "",
    });

    const staged = await apply(w, w.staging, { compose: false });
    expect(staged.skipped.map((s) => s.name)).toEqual(["postgres"]);

    // Nothing was torn down: the refused create made nothing, and production's
    // container of the same name is not this apply's to touch.
    expect(runtimeCalls.destroyed).toEqual([]);
    expect(await deploymentsOf(prod.ids)).toEqual(prod.deployments);
    // And the refused create left no row and no deployment behind: the only
    // deployments in the project are production's and staging redis's create.
    expect((await resourcesIn(w, w.staging)).has("postgres")).toBe(false);
    const redis = (await resourcesIn(w, w.staging)).get("redis");
    const expected = [...prod.deployments, ...(redis ? await deploymentsOf([redis.id]) : [])];
    expect(await projectDeployments(w)).toEqual(expected.sort());
  });

  it("a create that fails after its insert removes only its own container and deployment", async () => {
    const w = await world("iso-e");
    const prod = await productionLive(w);
    // Every staging provision fails, so each create rolls back.
    runtimeCalls.failProvision = true;

    const staged = await apply(w, w.staging, { compose: false });
    expect(staged.appliedCount).toBe(0);
    expect(staged.skipped.map((s) => s.name).sort()).toEqual(["postgres", "redis"]);

    // The rollback removed exactly the containers this apply tried to start,
    // and never one of production's.
    expect(runtimeCalls.destroyed.sort()).toEqual([...runtimeCalls.provisioned].sort());
    for (const name of prod.containers) expect(runtimeCalls.destroyed).not.toContain(name);
    // No row and no deployment survive the failed creates; production's
    // history is unchanged.
    expect((await resourcesIn(w, w.staging)).size).toBe(0);
    expect(await projectDeployments(w)).toEqual(prod.deployments);
  });
});
