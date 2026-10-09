/**
 * Procedures that take a project or resource id from their input act only
 * inside the caller's own organization.
 *
 * The org-scoped builder confirms the caller belongs to its active
 * organization; it does not check which organization a project or resource id
 * in the input belongs to. Each procedure here therefore scopes its own
 * lookup: compose stacks and their variables, an inline manifest diff, a
 * database's ephemeral credentials and its placement, a managed data session,
 * and DNS autoconfiguration for a service's domain. An id from another
 * organization reads as not found, and nothing of it changes. Also: a
 * presigned upload URL needs `backup:create`, not only `backup:read`.
 *
 * Drives the real router (middleware ladder, schemas, handlers, query modules)
 * against a migrated database, as API-key actors built the way createContext
 * builds them.
 */
import type { AnyProcedure } from "@orpc/server";
import type { OrganizationId, ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { createProcedureClient, isProcedure, ORPCError } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { databaseResource, resource } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Context } from "../../context";

import { appRouter } from "../../routers";
import { createComposeRecord } from "../../routers/compose/queries";
import { autoConfigureServiceDomainDns } from "../../routers/service/domains-autoconfigure";
import { createKeyContext } from "../postgres-actors";
import { seedDatabase, seedOrganization, seedProject, seedService, uniq } from "../postgres-seed";

// oxlint-disable-next-line node/no-process-env -- test boundary: no handler here may reach a real Docker daemon.
process.env.DOCKER_HOST = "unix:///nonexistent/org-scope-docker.sock";

const procedures = new Map<string, AnyProcedure>();
(function walk(node: unknown, path: readonly string[]) {
  if (isProcedure(node)) {
    procedures.set(path.join("."), node);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
})(appRouter, []);

type Outcome = { kind: "ok"; output: unknown } | { kind: "refused"; code: string; status: number };

async function call(name: string, context: Context, input: unknown): Promise<Outcome> {
  const procedure = procedures.get(name);
  if (!procedure) throw new Error(`no procedure ${name}`);
  const client = createProcedureClient(procedure, { context, path: name.split(".") });
  const called = await Result.tryPromise({ try: () => client(input), catch: (error) => error });
  if (called.isOk()) return { kind: "ok", output: called.value };
  if (called.error instanceof ORPCError) {
    return { kind: "refused", code: called.error.code, status: called.error.status };
  }
  throw called.error;
}

function expectNotFound(outcome: Outcome, label: string) {
  expect(outcome, label).toMatchObject({ kind: "refused", code: "NOT_FOUND" });
}

/** A key of `organizationId` holding exactly `permissions`. */
function keyWith(organizationId: OrganizationId, permissions: Record<string, string[]>): Context {
  const context = createKeyContext(organizationId, null);
  if (context.apiKey) context.apiKey.permissions = permissions;
  return context;
}

interface Tenant {
  organizationId: OrganizationId;
  projectId: ProjectId;
  slug: string;
  stackId: ResourceId;
  databaseId: ResourceId;
  serviceId: ResourceId;
  routeId: ProxyRouteId;
  key: Context;
}

const COMPOSE = "services:\n  web:\n    image: nginx:alpine\n";

async function seedTenant(prefix: string): Promise<Tenant> {
  const organizationId = await seedOrganization(prefix);
  const seeded = await seedProject(organizationId);
  const stack = await createComposeRecord({
    projectId: seeded.projectId,
    environmentId: seeded.mainEnvironmentId,
    name: `stack-${uniq()}`,
    source: "inline",
    composeContent: COMPOSE,
    stackName: `stack-${uniq()}`,
    services: [],
    variables: [{ key: "STACK_VALUE", value: `value-${prefix}`, isSecret: true }],
  });
  const database = await seedDatabase({
    projectId: seeded.projectId,
    environmentId: seeded.mainEnvironmentId,
    name: `db-${uniq()}`,
    tag: prefix,
  });
  const service = await seedService({
    projectId: seeded.projectId,
    environmentId: seeded.mainEnvironmentId,
    name: `web-${uniq()}`,
  });
  const [route] = await db
    .insert(proxyRoute)
    .values({
      projectId: seeded.projectId,
      resourceId: service.resourceId,
      type: "http",
      domain: `${prefix}-${uniq()}.org-scope.test`,
      upstreamHost: service.host,
      upstreamPort: 80,
      protocol: "http",
    })
    .returning({ id: proxyRoute.id });
  if (!route) throw new Error("route insert returned no row");
  return {
    organizationId,
    projectId: seeded.projectId,
    slug: seeded.slug,
    stackId: stack.resource.id,
    databaseId: database.resourceId,
    serviceId: service.resourceId,
    routeId: route.id,
    key: createKeyContext(organizationId, null),
  };
}

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  a = await seedTenant("scope-a");
  b = await seedTenant("scope-b");
});

describe("compose procedures act only on the caller's organization's stacks", () => {
  it("reads: list, get and listVariables", async () => {
    const own = await call("compose.get", a.key, { projectId: a.projectId, resourceId: a.stackId });
    expect(own.kind).toBe("ok");

    expectNotFound(
      await call("compose.get", b.key, { projectId: a.projectId, resourceId: a.stackId }),
      "compose.get",
    );
    expectNotFound(
      await call("compose.listVariables", b.key, {
        projectId: a.projectId,
        resourceId: a.stackId,
      }),
      "compose.listVariables",
    );
    const listed = await call("compose.list", b.key, { projectId: a.projectId });
    expect(listed).toEqual({ kind: "ok", output: [] });
  });

  it("writes: updateContent, setVariable, deleteVariable and delete leave the stack as it was", async () => {
    const target = { projectId: a.projectId, resourceId: a.stackId };
    const [before] = await db.select().from(resource).where(eq(resource.id, a.stackId));
    expectNotFound(
      await call("compose.updateContent", b.key, {
        ...target,
        composeContent: "services:\n  other:\n    image: busybox\n",
      }),
      "compose.updateContent",
    );
    expectNotFound(
      await call("compose.setVariable", b.key, { ...target, key: "STACK_VALUE", value: "x" }),
      "compose.setVariable",
    );
    expectNotFound(
      await call("compose.deleteVariable", b.key, { ...target, key: "STACK_VALUE" }),
      "compose.deleteVariable",
    );
    expectNotFound(await call("compose.delete", b.key, target), "compose.delete");

    const [after] = await db.select().from(resource).where(eq(resource.id, a.stackId));
    expect(after).toEqual(before);
    const own = await call("compose.listVariables", a.key, target);
    expect(JSON.stringify(own)).toContain("STACK_VALUE");
  });
});

describe("project.manifest.diff with an inline manifest", () => {
  it("diffs against the caller's own project and answers NOT_FOUND for another organization's", async () => {
    const manifest = {
      project: a.slug,
      services: { worker: { source: "image", image: "busybox:1" } },
    };
    const own = await call("project.manifest.diff", a.key, { projectId: a.projectId, manifest });
    expect(own.kind).toBe("ok");
    expectNotFound(
      await call("project.manifest.diff", b.key, { projectId: a.projectId, manifest }),
      "project.manifest.diff",
    );
  });
});

describe("database ephemeral credentials", () => {
  it("are listed for the caller's own database only", async () => {
    expect(await call("database.ephemeralList", a.key, { resourceId: a.databaseId })).toMatchObject(
      {
        kind: "ok",
      },
    );
    expectNotFound(
      await call("database.ephemeralList", b.key, { resourceId: a.databaseId }),
      "database.ephemeralList",
    );
    expectNotFound(
      await call("database.ephemeralRevoke", b.key, {
        resourceId: a.databaseId,
        credentialId: "dbeph_missing",
      }),
      "database.ephemeralRevoke",
    );
  });
});

describe("postgres setPlacement", () => {
  it("answers NOT_FOUND for another organization's project and leaves the database's placement alone", async () => {
    const placement = async () => {
      const [row] = await db
        .select({ placement: resource.placementServerId })
        .from(resource)
        .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
        .where(eq(resource.id, a.databaseId));
      return row?.placement;
    };
    const before = await placement();
    expectNotFound(
      await call("project.resource.database.postgres.setPlacement", b.key, {
        projectId: a.projectId,
        resourceId: a.databaseId,
        serverId: null,
      }),
      "setPlacement",
    );
    expect(await placement()).toEqual(before);
  });
});

describe("data.openSession on a managed database", () => {
  it("answers NOT_FOUND for a database outside the caller's organization", async () => {
    expectNotFound(
      await call("data.openSession", b.key, {
        target: { kind: "resource", resourceId: a.databaseId },
      }),
      "data.openSession",
    );
  });
});

describe("DNS autoconfiguration for a service domain", () => {
  it("finds the route only in the caller's own organization and project", async () => {
    const own = await autoConfigureServiceDomainDns({
      organizationId: a.organizationId,
      projectId: a.projectId,
      resourceId: a.serviceId,
      routeId: a.routeId,
      serverIp: null,
    });
    // Found: it stops at the next requirement, not at the lookup.
    expect(own.isErr() && own.error.reason).toBe("no-server-ip");

    for (const projectId of [a.projectId, b.projectId]) {
      const other = await autoConfigureServiceDomainDns({
        organizationId: b.organizationId,
        projectId,
        resourceId: a.serviceId,
        routeId: a.routeId,
        serverIp: null,
      });
      expect(other.isErr() && other.error.reason).toBe("not-found");
    }
  });
});

describe("storage.presign", () => {
  it("a PUT (upload) URL needs backup:create; backup:read alone is refused", async () => {
    const bucketId = createId(ID_PREFIX.backupDestination);
    const readOnly = keyWith(a.organizationId, { backup: ["read"] });
    expect(
      await call("storage.presign", readOnly, { bucketId, key: "dumps/x.sql", method: "PUT" }),
    ).toMatchObject({ kind: "refused", code: "FORBIDDEN" });
    // GET stays a read: past the permission check, to the (missing) bucket.
    expectNotFound(
      await call("storage.presign", readOnly, { bucketId, key: "dumps/x.sql", method: "GET" }),
      "presign GET",
    );
    const writer = keyWith(a.organizationId, { backup: ["read", "create"] });
    expectNotFound(
      await call("storage.presign", writer, { bucketId, key: "dumps/x.sql", method: "PUT" }),
      "presign PUT with backup:create",
    );
  });
});
