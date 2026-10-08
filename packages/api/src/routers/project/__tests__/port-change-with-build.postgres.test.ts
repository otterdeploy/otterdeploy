/**
 * a port change in the same deploy as a build.
 *
 * `otterdeploy deploy` applies the manifest, then uploads the service's source,
 * which builds. When the manifest also moved the service's port, the apply
 * rolled the CURRENTLY RUNNING image onto the new port first. That image never
 * listens there, so the rollout waited out its whole readiness window and the
 * apply hit the 120 s request deadline. The deploy now says
 * which services' sources follow (`sourceUploads`), and their changes ride
 * those builds. A port change with no build behind it still rolls at once.
 *
 * Drives the CLI's calls (manifest.get, manifest.save, manifest.applyChange)
 * through the real procedures (middleware included) against a migrated
 * Postgres. Only the container
 * runtime is stood in for, and it records every rollout it is asked for.
 */
import type { AnyProcedure } from "@orpc/server";

import { createProcedureClient } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as z from "zod";

import type { Context } from "../../../context";

import { listServicePorts } from "../../service/queries";

const rollouts = vi.hoisted(() => ({
  updates: new Array<{ resourceName: string; image: string; ports: number[] }>(),
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
    update: async (spec: {
      serviceName: string;
      networkName: string;
      resourceName: string;
      image: string;
      ports: ReadonlyArray<{ containerPort: number }>;
    }) => {
      rollouts.updates.push({
        resourceName: spec.resourceName,
        image: spec.image,
        ports: spec.ports.map((p) => p.containerPort),
      });
      return healthy(spec);
    },
    destroy: async () => undefined,
    inspect: async (input: { serviceName: string }) => healthy(input),
    inspectMany: async (inputs: ReadonlyArray<{ serviceName: string }>) =>
      new Map(inputs.map((i) => [i.serviceName, healthy(i)])),
  };
  return { ...actual, runtime: () => driver };
});

const { createKeyContext } = await import("../../../__tests__/postgres-actors");
const { seedOrganization, seedProject } = await import("../../../__tests__/postgres-seed");
const { appRouter } = await import("../../index");

type Outcome = { kind: "ok"; output: unknown } | { kind: "error"; thrown: string; stack: string };

/** Run one procedure as the organization's full-access API key, the way the
 *  CLI authenticates, and settle it into an outcome a test can assert on. */
async function call(
  procedure: AnyProcedure,
  path: string[],
  context: Context,
  input: unknown,
): Promise<Outcome> {
  const client = createProcedureClient(procedure, { context, path });
  const called = await Result.tryPromise({ try: () => client(input), catch: (error) => error });
  if (called.isOk()) return { kind: "ok", output: called.value };
  const error = called.error;
  return {
    kind: "error",
    thrown: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? "") : "",
  };
}

const world = await (async () => {
  const organizationId = await seedOrganization("port-change");
  const seeded = await seedProject(organizationId);
  return {
    projectId: seeded.projectId,
    slug: seeded.slug,
    context: createKeyContext(organizationId, null),
  };
})();

const manifestGet = (projectId: string) =>
  call(appRouter.project.manifest.get, ["project", "manifest", "get"], world.context, {
    id: projectId,
  });
const manifestSave = (input: unknown) =>
  call(appRouter.project.manifest.save, ["project", "manifest", "save"], world.context, input);
const manifestApplyChange = (input: unknown) =>
  call(
    appRouter.project.manifest.applyChange,
    ["project", "manifest", "applyChange"],
    world.context,
    input,
  );

const versioned = z.object({ version: z.number() });

interface WebSpec {
  port: number;
  env?: Record<string, string>;
}

/** `web` builds from uploaded source; `api` reads web's URL, so it rolls
 *  whenever web's row changes. */
function manifestFor(slug: string, web: WebSpec) {
  return {
    project: slug,
    services: {
      web: {
        source: "upload",
        build: { builder: "railpack" },
        ports: [{ container: web.port, appProtocol: "http", primary: true }],
        ...(web.env ? { env: web.env } : {}),
      },
      api: {
        source: "image",
        image: "nginx:1.27-alpine",
        ports: [{ container: 80, appProtocol: "http", primary: true }],
        env: { WEB_URL: "${{web.URL}}" },
      },
    },
    databases: {},
  };
}

/** The CLI's `deploy` (apps/cli/src/lib/deploy-run.ts): save, then apply,
 *  naming the services whose source it uploads next. */
async function deploy(
  projectId: string,
  slug: string,
  web: WebSpec,
  sourceUploads: string[] | undefined,
) {
  const current = await manifestGet(projectId);
  if (current.kind !== "ok") return current;
  const saved = await manifestSave({
    projectId,
    manifest: manifestFor(slug, web),
    expectedVersion: versioned.parse(current.output).version,
  });
  if (saved.kind !== "ok") return saved;
  return manifestApplyChange({
    projectId,
    manifest: manifestFor(slug, web),
    expectedVersion: versioned.parse(saved.output).version,
    ...(sourceUploads ? { sourceUploads } : {}),
  });
}

function rolled(name: string) {
  return rollouts.updates.filter((u) => u.resourceName === name);
}

async function resolveWorld() {
  return { projectId: world.projectId, slug: world.slug };
}

async function resolveWebId(projectId: string) {
  const [web] = await db
    .select({ id: resource.id })
    .from(resource)
    .where(
      and(eq(resource.projectId, idSchema.project.parse(projectId)), eq(resource.name, "web")),
    );
  if (!web) throw new Error("the first deploy created no web service");
  return web.id;
}

function expectOk(outcome: Awaited<ReturnType<typeof deploy>>) {
  expect(outcome.kind, outcome.kind === "error" ? `${outcome.thrown}\n${outcome.stack}` : "").toBe(
    "ok",
  );
}

describe("a live service's port changes in the same deploy as its build", () => {
  beforeEach(() => {
    rollouts.updates.length = 0;
  });

  it("first deploy: web is created and built on port 3000", async () => {
    const { projectId, slug } = await resolveWorld();
    expectOk(await deploy(projectId, slug, { port: 3000 }, ["web"]));
    const webId = await resolveWebId(projectId);
    // What the upload's build leaves behind: a real image on the service.
    await db
      .update(serviceResource)
      .set({ image: "otterdeploy-local/web:built" })
      .where(eq(serviceResource.resourceId, webId));
  });

  it("does not roll the old image onto the new port when the source upload follows", async () => {
    const { projectId, slug } = await resolveWorld();

    expectOk(await deploy(projectId, slug, { port: 8080 }, ["web"]));

    // The old image was never asked to come up on 8080: the build that the
    // upload starts rolls the new image onto it.
    expect(rolled("web")).toEqual([]);
    // The new port is saved, so that build's rollout carries it.
    const ports = await listServicePorts(await resolveWebId(projectId));
    expect(ports.map((p) => p.containerPort)).toEqual([8080]);
    // A service that reads web's URL still rolls: its token reads the row.
    expect(rolled("api").length).toBeGreaterThan(0);
  });

  it("does not roll the old image for a declared env change either", async () => {
    const { projectId, slug } = await resolveWorld();

    expectOk(await deploy(projectId, slug, { port: 9090, env: { GREETING: "hi" } }, ["web"]));

    expect(rolled("web")).toEqual([]);
    const ports = await listServicePorts(await resolveWebId(projectId));
    expect(ports.map((p) => p.containerPort)).toEqual([9090]);
  });

  it("still rolls the running image at once when no build follows", async () => {
    const { projectId, slug } = await resolveWorld();

    expectOk(await deploy(projectId, slug, { port: 7070, env: { GREETING: "hi" } }, undefined));

    const web = rolled("web");
    expect(web.length).toBeGreaterThan(0);
    expect(web.every((u) => u.image === "otterdeploy-local/web:built")).toBe(true);
    expect(web.every((u) => u.ports.includes(7070))).toBe(true);
  });

  it("ignores a declared upload for a service that does not build from uploads", async () => {
    const { projectId, slug } = await resolveWorld();
    const before = rollouts.updates.length;

    // api is an image service: nothing builds it, so naming it must not leave
    // its change unrolled.
    const current = await manifestGet(projectId);
    if (current.kind !== "ok") throw new Error("manifest.get failed");
    const manifest = manifestFor(slug, { port: 7070, env: { GREETING: "hi" } });
    const changed = {
      ...manifest,
      services: {
        ...manifest.services,
        api: { ...manifest.services.api, image: "nginx:1.28-alpine" },
      },
    };
    const applied = await manifestApplyChange({
      projectId,
      manifest: changed,
      expectedVersion: versioned.parse(current.output).version,
      sourceUploads: ["api"],
    });
    expectOk(applied);

    const api = rollouts.updates.slice(before).filter((u) => u.resourceName === "api");
    expect(api.some((u) => u.image === "nginx:1.28-alpine")).toBe(true);
  });
});
