/**
 * A key minted for selected projects is confined by every project reference a
 * procedure declares (../project-refs.ts), enforced centrally for every
 * org-scoped builder: an `id` or a `slug` that names a project, a nested
 * declared path, the legacy id spelling `zId` still accepts, an object that
 * does not exist (left to the handler's NOT_FOUND), and the fail-closed answer
 * to an undeclared id-like field. Inbound webhooks and proxy-route writes are
 * covered end to end: refused, and nothing written.
 *
 * Drives the real router (middleware ladder included) against a migrated
 * database. The key actor is built directly, the way createContext builds it
 * from a verified key; `probe` swaps only the handler for a sentinel so
 * "reached" means exactly "the guards let this caller through".
 */
import type { AnyProcedure } from "@orpc/server";
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { createProcedureClient, isProcedure, ORPCError, Procedure } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { member, user } from "@otterdeploy/db/schema/auth";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { inboundEndpoint } from "@otterdeploy/db/schema/webhooks";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../context";
import type { ApiKeyActor } from "../actor";

import { seedOrganization, seedProject, seedService, uniq } from "../../__tests__/postgres-seed";
import { appRouter } from "../../routers";

// oxlint-disable-next-line node/no-process-env -- test boundary: no handler here may reach a real Docker daemon.
process.env.DOCKER_HOST = "unix:///nonexistent/project-scope-docker.sock";

const SCOPE_REFUSAL = /not scoped to that project|is not declared/;

const procedures = new Map<string, AnyProcedure>();
(function walk(node: unknown, path: readonly string[]) {
  if (isProcedure(node)) {
    procedures.set(path.join("."), node);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
})(appRouter, []);

function requireProcedure(name: string): AnyProcedure {
  const found = procedures.get(name);
  if (!found) throw new Error(`no procedure ${name}`);
  return found;
}

function createKeyContext(organizationId: OrganizationId, projectIds: ProjectId[] | null): Context {
  const apiKey: ApiKeyActor = {
    kind: "api-key",
    id: `key_${uniq()}`,
    permissions: null,
    organizationId,
    ...(projectIds ? { projectScope: "selected", projectIds } : { projectScope: "all" }),
  };
  return {
    actor: apiKey,
    session: null,
    apiKey,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: vi.fn(),
  };
}

/** A real member of the organization, as a session actor. */
async function createMemberContext(organizationId: OrganizationId): Promise<Context> {
  const email = `member-${uniq()}@scope.test`;
  const [created] = await db
    .insert(user)
    .values({ name: "member", email })
    .returning({ id: user.id });
  if (!created) throw new Error("user insert returned no row");
  await db.insert(member).values({ organizationId, userId: created.id, role: "owner" });
  const session = {
    kind: "session" as const,
    headers: new Headers(),
    user: { id: created.id, email, isInstallAdmin: false, twoFactorEnabled: true },
    session: { activeOrganizationId: organizationId },
  };
  return {
    actor: session,
    session,
    apiKey: null,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: vi.fn(),
  };
}

type Outcome = { kind: "reached" } | { kind: "refused"; code: string; message: string };

const REACHED = "handler reached";

function settle(error: unknown): Outcome {
  if (error instanceof ORPCError)
    return { kind: "refused", code: error.code, message: error.message };
  throw error;
}

/** The procedure's guards only: handler and schemas replaced. */
async function probe(name: string, context: Context, input: Record<string, unknown>) {
  const stub = new Procedure({
    ...requireProcedure(name)["~orpc"],
    inputSchema: undefined,
    outputSchema: undefined,
    handler: async () => REACHED,
  });
  const client = createProcedureClient(stub, { context, path: name.split(".") });
  const called = await Result.tryPromise({ try: () => client(input), catch: (error) => error });
  if (called.isErr()) return settle(called.error);
  return { kind: "reached" } satisfies Outcome;
}

/** The real procedure, schemas and handler included. */
async function call(name: string, context: Context, input: Record<string, unknown>) {
  const client = createProcedureClient(requireProcedure(name), { context, path: name.split(".") });
  const called = await Result.tryPromise({ try: () => client(input), catch: (error) => error });
  if (called.isErr()) return settle(called.error);
  return { kind: "reached" } satisfies Outcome;
}

function expectScopeRefusal(outcome: Outcome, label: string) {
  expect(outcome, label).toMatchObject({ kind: "refused", code: "FORBIDDEN" });
  if (outcome.kind === "refused") expect(outcome.message, label).toMatch(SCOPE_REFUSAL);
}

interface SeededProject {
  projectId: ProjectId;
  slug: string;
  resourceId: ResourceId;
  routeId: string;
  endpointId: string;
}

async function seedScopedProject(organizationId: OrganizationId): Promise<SeededProject> {
  const seeded = await seedProject(organizationId);
  const label = `scope${uniq()}`;
  const service = await seedService({
    projectId: seeded.projectId,
    environmentId: seeded.mainEnvironmentId,
    name: `${label}-svc`,
  });
  const [route] = await db
    .insert(proxyRoute)
    .values({
      projectId: seeded.projectId,
      resourceId: service.resourceId,
      type: "http",
      domain: `${label}.scope.test`,
      upstreamHost: service.host,
      upstreamPort: 80,
      protocol: "http",
    })
    .returning({ id: proxyRoute.id });
  const [endpoint] = await db
    .insert(inboundEndpoint)
    .values({
      organizationId,
      name: `${label}-hook`,
      token: `tok-${label}`,
      encryptedSecret: `sealed-${label}`,
      resourceId: service.resourceId,
    })
    .returning({ id: inboundEndpoint.id });
  if (!route || !endpoint) throw new Error("project object seed returned no row");
  return {
    projectId: seeded.projectId,
    slug: seeded.slug,
    resourceId: service.resourceId,
    routeId: route.id,
    endpointId: endpoint.id,
  };
}

/** The same id in its pre-shortening spelling (`res_x` -> `resource_x`). */
function legacySpelling(id: string, legacyPrefix: string): string {
  return `${legacyPrefix}${id.slice(id.indexOf("_"))}`;
}

let organizationId: OrganizationId;
let own: SeededProject;
let other: SeededProject;
let scopedKey: Context;

beforeAll(async () => {
  organizationId = await seedOrganization("scope");
  own = await seedScopedProject(organizationId);
  other = await seedScopedProject(organizationId);
  scopedKey = createKeyContext(organizationId, [own.projectId]);
});

describe("a project-scoped API key is confined by every declared project reference", () => {
  it("project.update names its project by `id`: another project is refused and left untouched", async () => {
    const [before] = await db.select().from(project).where(eq(project.id, other.projectId));
    expectScopeRefusal(
      await call("project.update", scopedKey, { id: other.projectId, name: "renamed" }),
      "project.update",
    );
    const [after] = await db.select().from(project).where(eq(project.id, other.projectId));
    expect(after).toEqual(before);
    expect(await probe("project.update", scopedKey, { id: own.projectId })).not.toMatchObject({
      message: expect.stringMatching(SCOPE_REFUSAL),
    });
  });

  it("project.getBySlug names its project by `slug`", async () => {
    expectScopeRefusal(
      await probe("project.getBySlug", scopedKey, { slug: other.slug }),
      "getBySlug",
    );
    expect(await probe("project.getBySlug", scopedKey, { slug: own.slug })).toEqual({
      kind: "reached",
    });
  });

  it("a nested declared path (data.browse target.resourceId)", async () => {
    const target = (resourceId: string) => ({ target: { kind: "resource", resourceId } });
    expectScopeRefusal(
      await probe("data.browse", scopedKey, target(other.resourceId)),
      "data.browse",
    );
    expect(await probe("data.browse", scopedKey, target(own.resourceId))).toEqual({
      kind: "reached",
    });
  });

  it("the legacy id spelling is resolved to the same object", async () => {
    expectScopeRefusal(
      await probe("project.resource.get", scopedKey, {
        resourceId: legacySpelling(other.resourceId, "resource"),
      }),
      "legacy resource id",
    );
    expect(
      await probe("project.dependencies", scopedKey, {
        projectId: legacySpelling(own.projectId, "project"),
      }),
    ).toEqual({ kind: "reached" });
  });

  it("an object that does not exist is left to the handler", async () => {
    expect(
      await probe("project.proxyRoute.setEnabled", scopedKey, { routeId: "rt_doesnotexist0000" }),
    ).toEqual({ kind: "reached" });
  });

  it("an undeclared id-like field fails closed for a scoped key only", async () => {
    const listing = requireProcedure("project.list");
    const undeclared = new Procedure({
      ...listing["~orpc"],
      inputSchema: undefined,
      outputSchema: undefined,
      handler: async () => REACHED,
    });
    const outcome = async (context: Context) => {
      const client = createProcedureClient(undeclared, { context, path: ["project", "list"] });
      const called = await Result.tryPromise({
        try: () => client({ widgetId: "wdg_anything" }),
        catch: (error) => error,
      });
      return called.isOk() ? { kind: "reached" } : settle(called.error);
    };
    expect(await outcome(scopedKey)).toMatchObject({ kind: "refused", code: "FORBIDDEN" });
    expect(await outcome(createKeyContext(organizationId, null))).toEqual({ kind: "reached" });
    expect(await outcome(await createMemberContext(organizationId))).toEqual({ kind: "reached" });
  });
});

async function endpointRows(): Promise<string> {
  const rows = await db
    .select()
    .from(inboundEndpoint)
    .where(eq(inboundEndpoint.organizationId, organizationId));
  return JSON.stringify(rows.toSorted((a, b) => a.id.localeCompare(b.id)));
}

describe("inbound webhooks stay inside a project-scoped key's projects", () => {
  it("create, update and pause cannot bind to or touch another project's resource or endpoint", async () => {
    const before = await endpointRows();
    const attempts = [
      call("webhooks.inbound.create", scopedKey, {
        name: "scoped-key-hook",
        resourceId: other.resourceId,
        action: "redeploy",
      }),
      // Re-pointing the key's own endpoint at another project's resource.
      call("webhooks.inbound.update", scopedKey, {
        id: own.endpointId,
        resourceId: other.resourceId,
      }),
      call("webhooks.inbound.pause", scopedKey, { id: other.endpointId }),
    ];
    for (const outcome of await Promise.all(attempts)) expectScopeRefusal(outcome, "inbound");
    expect(await endpointRows()).toBe(before);

    expect(
      await probe("webhooks.inbound.create", scopedKey, { resourceId: own.resourceId }),
    ).toEqual({ kind: "reached" });
  });
});

describe("proxy-route writes stay inside a project-scoped key's projects", () => {
  const writes = [
    "project.proxyRoute.setCustomDirectives",
    "project.proxyRoute.setEnabled",
    "project.proxyRoute.setProtection",
    "project.proxyRoute.setRoutePolicy",
    "project.proxyRoute.createShareLink",
  ];

  it("every routeId-addressed write refuses another project's route and changes nothing", async () => {
    const routeRow = async () =>
      JSON.stringify(
        await db.select().from(proxyRoute).where(eq(proxyRoute.projectId, other.projectId)),
      );
    const before = await routeRow();
    for (const name of writes)
      expectScopeRefusal(await call(name, scopedKey, { routeId: other.routeId }), name);
    expect(await routeRow()).toBe(before);
  });

  it("the same writes still reach the handler for the key's own route", async () => {
    for (const name of writes)
      expect(await probe(name, scopedKey, { routeId: own.routeId }), name).toEqual({
        kind: "reached",
      });
  });
});
