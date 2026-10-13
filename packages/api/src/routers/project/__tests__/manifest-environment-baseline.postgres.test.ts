/**
 * Against a migrated Postgres: each environment's pending changes are measured
 * against what THAT environment applied, never against another one's apply.
 *
 * A project has one saved manifest and many environments. The applied
 * snapshot used to be one per project too, and it held the manifest RESOLVED
 * for whichever environment applied last. Two things read it as if it
 * described the environment on screen:
 *
 *   - the diff, as proof the manifest once owned a resource, so a resource
 *     another environment applied read as a pending DELETE here, on a running
 *     resource nobody removed;
 *   - discard, which copied it into the saved manifest, baking another
 *     environment's overrides into the base, so the change it was asked to
 *     drop came straight back and the bar never cleared.
 *
 * Drives the real procedures and query modules; only RBAC, the container
 * runtime, the image pull, the boot-log tail and Caddy are stood in for.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { environment, resource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface RuntimeCalls {
  destroyed: string[];
  /** A delete to add to every plan, standing in for a faulty diff. */
  injectDelete: null | { resource: "database"; name: string };
}

const runtimeCalls = vi.hoisted(() => {
  const calls: RuntimeCalls = { destroyed: [], injectDelete: null };
  return calls;
});

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: async () => ({ success: true }) } },
}));

vi.mock("../../../runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../runtime")>();
  const driver = {
    ...actual.runtime(),
    provisionDatabase: async () => ({ status: "running" as const }),
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

vi.mock("../../../lib/escape-hatch", () => ({ writeProjectEscapeHatch: async () => undefined }));

vi.mock("../../../stack/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../stack/manifest")>();
  return {
    ...actual,
    diffManifest: (...args: Parameters<typeof actual.diffManifest>) => {
      const planned = actual.diffManifest(...args);
      const extra = runtimeCalls.injectDelete;
      return extra ? [...planned, { kind: "delete" as const, ...extra }] : planned;
    },
  };
});

const { seedOrganization, seedProject, seedEnvironment, seedDatabase, uniq } =
  await import("../../../__tests__/postgres-seed");
const { createMemberContext } = await import("../../../__tests__/postgres-actors");
const { projectRouter } = await import("../index");

type Context = Awaited<ReturnType<typeof createMemberContext>>;

interface World {
  projectId: ProjectId;
  slug: string;
  context: Context;
  production: { id: EnvironmentId; slug: string };
  staging: { id: EnvironmentId; slug: string };
}

async function world(label: string): Promise<World> {
  const organizationId = await seedOrganization(label);
  const seeded = await seedProject(organizationId, `mb-${uniq()}`);
  const [main] = await db
    .select({ slug: environment.slug })
    .from(environment)
    .where(eq(environment.id, seeded.mainEnvironmentId));
  if (!main) throw new Error("seeded project has no main environment row");
  const staging = await seedEnvironment(seeded.projectId, "staging");
  return {
    projectId: seeded.projectId,
    slug: seeded.slug,
    context: await createMemberContext(organizationId),
    production: { id: seeded.mainEnvironmentId, slug: main.slug },
    staging: { id: staging, slug: "staging" },
  };
}

/** The manifest procedures, called as the project's member. */
function procedures(w: World) {
  const { manifest } = projectRouter;
  const context = w.context;
  return {
    get: createProcedureClient(manifest.get, { context }),
    save: createProcedureClient(manifest.save, { context }),
    diff: createProcedureClient(manifest.diff, { context }),
    apply: createProcedureClient(manifest.apply, { context }),
    discard: createProcedureClient(manifest.discard, { context }),
    rename: createProcedureClient(manifest.rename, { context }),
  };
}

function procedure<K extends keyof ReturnType<typeof procedures>>(w: World, name: K) {
  return procedures(w)[name];
}

async function save(w: World, manifest: Record<string, unknown>) {
  const stored = await procedure(w, "get")({ id: w.projectId });
  return procedure(
    w,
    "save",
  )({
    projectId: w.projectId,
    expectedVersion: stored.version,
    manifest: {
      project: w.slug,
      services: {},
      databases: {},
      composes: {},
      ...manifest,
    },
  });
}

async function pending(w: World, env: { slug: string }) {
  const diff = await procedure(w, "diff")({ projectId: w.projectId, environment: env.slug });
  return diff.changes
    .filter((c) => c.kind !== "no-op")
    .map((c) => `${c.kind} ${c.resource} ${c.name}`)
    .sort();
}

function apply(w: World, env: { slug: string }) {
  return procedure(w, "apply")({ projectId: w.projectId, environment: env.slug });
}

async function namesIn(w: World, environmentId: EnvironmentId): Promise<string[]> {
  const rows = await db
    .select({ name: resource.name })
    .from(resource)
    .where(and(eq(resource.projectId, w.projectId), eq(resource.environmentId, environmentId)));
  return rows.map((r) => r.name).sort();
}

beforeEach(() => {
  runtimeCalls.destroyed.length = 0;
  runtimeCalls.injectDelete = null;
});

describe("a delete needs proof from the environment it would run in", () => {
  it("a resource another environment applied is not a pending delete here", async () => {
    const w = await world("mb-a");
    // `cache` was created in production by hand: it was never in the manifest.
    await seedDatabase({
      projectId: w.projectId,
      environmentId: w.production.id,
      name: "cache",
      tag: "prod",
      engine: "redis",
    });
    // Staging declares a `cache` of its own, in its own block.
    await save(w, {
      databases: { postgres: { engine: "postgres", version: "18" } },
      environments: {
        staging: { databases: { cache: { engine: "redis", version: "7.4" } } },
      },
    });
    expect((await apply(w, w.production)).skipped).toEqual([]);
    expect(await pending(w, w.production)).toEqual([]);

    expect((await apply(w, w.staging)).skipped).toEqual([]);

    // Nobody removed production's cache from anything.
    expect(await pending(w, w.production)).toEqual([]);
    await apply(w, w.production);
    expect(runtimeCalls.destroyed).toEqual([]);
    expect(await namesIn(w, w.production.id)).toEqual(["cache", "postgres"]);
  });

  it("a resource the operator removed is still a pending delete, and applies", async () => {
    const w = await world("mb-b");
    await save(w, {
      databases: {
        postgres: { engine: "postgres", version: "18" },
        cache: { engine: "redis", version: "7.4" },
      },
    });
    await apply(w, w.production);
    await apply(w, w.staging);

    await save(w, { databases: { postgres: { engine: "postgres", version: "18" } } });

    expect(await pending(w, w.production)).toEqual(["delete database cache"]);
    expect(await pending(w, w.staging)).toEqual(["delete database cache"]);
    await apply(w, w.staging);
    expect(await namesIn(w, w.staging.id)).toEqual(["postgres"]);
    // Production's copy is production's to delete, on production's apply.
    expect(await namesIn(w, w.production.id)).toEqual(["cache", "postgres"]);
  });

  it("an environment that opts a resource out deletes only its own copy", async () => {
    const w = await world("mb-c");
    await save(w, {
      databases: {
        postgres: { engine: "postgres", version: "18" },
        cache: { engine: "redis", version: "7.4" },
      },
    });
    await apply(w, w.production);
    await apply(w, w.staging);

    await save(w, {
      databases: {
        postgres: { engine: "postgres", version: "18" },
        cache: { engine: "redis", version: "7.4" },
      },
      environments: { staging: { databases: { cache: null } } },
    });

    expect(await pending(w, w.staging)).toEqual(["delete database cache"]);
    expect(await pending(w, w.production)).toEqual([]);
  });
});

describe("apply refuses a delete it cannot trace to a removal", () => {
  it("a delete the manifest never asked for is refused, and nothing is destroyed", async () => {
    const w = await world("mb-d");
    await seedDatabase({
      projectId: w.projectId,
      environmentId: w.production.id,
      name: "cache",
      tag: "prod",
      engine: "redis",
    });
    await save(w, { databases: { postgres: { engine: "postgres", version: "18" } } });
    await apply(w, w.production);

    runtimeCalls.injectDelete = { resource: "database", name: "cache" };
    await expect(apply(w, w.production)).rejects.toMatchObject({
      code: "UNTRACED_DELETE",
      status: 409,
    });
    expect(runtimeCalls.destroyed).toEqual([]);
    expect(await namesIn(w, w.production.id)).toEqual(["cache", "postgres"]);
  });
});

describe("discard works on the environment the bar shows", () => {
  it("discarding in production clears production, whatever staging applied", async () => {
    const w = await world("mb-e");
    await save(w, {
      databases: {
        postgres: { engine: "postgres", version: "18", extraEnv: { LOG_LEVEL: "info" } },
      },
      environments: {
        staging: { databases: { postgres: { extraEnv: { LOG_LEVEL: "debug" } } } },
      },
    });
    await apply(w, w.production);
    await apply(w, w.staging);
    expect(await pending(w, w.production)).toEqual([]);

    // Stage a change while looking at production, then think better of it.
    const stored = await procedure(w, "get")({ id: w.projectId });
    if (!stored.manifest) throw new Error("no manifest saved");
    await save(w, {
      ...stored.manifest,
      databases: { ...stored.manifest.databases, cache: { engine: "redis", version: "7.4" } },
    });
    expect(await pending(w, w.production)).toEqual(["create database cache"]);

    await procedure(w, "discard")({ projectId: w.projectId, environment: w.production.slug });

    expect(await pending(w, w.production)).toEqual([]);
    // And staging still runs what it declared: its override was not folded
    // into everyone's base, nor dropped.
    expect(await pending(w, w.staging)).toEqual([]);
  });

  it("discard never turns another environment's running resource into a delete", async () => {
    const w = await world("mb-f");
    await save(w, { databases: { postgres: { engine: "postgres", version: "18" } } });
    await apply(w, w.production);

    // Staging gains `cache`, staged on the shared base, and applies it.
    await save(w, {
      databases: {
        postgres: { engine: "postgres", version: "18" },
        cache: { engine: "redis", version: "7.4" },
      },
    });
    await apply(w, w.staging);
    // Production does not want it.
    expect(await pending(w, w.production)).toEqual(["create database cache"]);
    await procedure(w, "discard")({ projectId: w.projectId, environment: w.production.slug });

    expect(await pending(w, w.production)).toEqual([]);
    expect(await pending(w, w.staging)).toEqual([]);
  });
});

describe("a rename is refused for a resource running in any environment", () => {
  it("a database deployed only in staging cannot be renamed", async () => {
    const w = await world("mb-g");
    await save(w, {
      databases: {
        postgres: { engine: "postgres", version: "18" },
        cache: { engine: "redis", version: "7.4" },
      },
      environments: { [w.production.slug]: { databases: { cache: null } } },
    });
    await apply(w, w.production);
    await apply(w, w.staging);

    await expect(
      procedure(
        w,
        "rename",
      )({
        projectId: w.projectId,
        resource: "database",
        from: "cache",
        to: "kv",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pending(w, w.staging)).toEqual([]);
  });
});
