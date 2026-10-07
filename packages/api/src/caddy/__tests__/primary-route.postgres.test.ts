/**
 * One primary route per resource, under concurrency.
 *
 * Two domains added to a service with none at the same instant: both
 * `domains.add` calls read "no routes yet" and both inserted a primary. Here
 * the real procedure races itself against a migrated Postgres, the DNS answer
 * stood in for at its one network boundary (lib/dns-resolver.ts).
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { closeQueues } from "@otterdeploy/jobs";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../__tests__/postgres-seed";
import { isUniqueViolation } from "../../lib/pg-error";
import { addServiceDomain } from "../../routers/service/domains";
import { createServiceRecord } from "../../routers/service/queries/service";
import { promotePrimaryRoute } from "../primary-route";

const { redisUrl } = vi.hoisted(() => {
  /* oxlint-disable node/no-process-env -- test env boundary: no Docker daemon (the post-add redeploy must fail fast), and the platform events need the opt-in integration Redis */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-primary-route.sock";
  const url = process.env.INTEGRATION_REDIS_URL;
  if (url) process.env.REDIS_URL = url;
  /* oxlint-enable node/no-process-env */
  return { redisUrl: url };
});

// Every host reads unpointed: the route stays inert (no Caddy reconcile), and
// what is under test is only the row write.
vi.mock("../../lib/dns-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/dns-resolver")>();
  return {
    ...actual,
    resolveAddressesRobust: async (name: string) =>
      Result.err(new actual.DnsRecordMissing({ name, code: "ENOTFOUND", cause: null })),
  };
});

const log = createRequestLogger({ method: "TEST", path: "/caddy/primary-route" });
const ROUNDS = 10;

let organizationId: OrganizationId;
let projectId: ProjectId;
let environmentId: Awaited<ReturnType<typeof seedProject>>["mainEnvironmentId"];

async function createWebService(): Promise<ResourceId> {
  const name = `web-${uniq()}`;
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

async function primaries(resourceId: ResourceId): Promise<string[]> {
  const rows = await db
    .select({ domain: proxyRoute.domain })
    .from(proxyRoute)
    .where(
      and(
        eq(proxyRoute.resourceId, resourceId),
        isNull(proxyRoute.previewId),
        eq(proxyRoute.isPrimary, true),
      ),
    );
  return rows.map((r) => r.domain);
}

async function add(resourceId: ResourceId) {
  const added = await addServiceDomain(
    { organizationId, projectId, resourceId, domain: `app-${uniq()}.example.org` },
    log,
  );
  if (added.isErr()) throw added.error;
  return idSchema.proxyRoute.parse(added.value.id);
}

beforeAll(async () => {
  if (!redisUrl) return;
  organizationId = await seedOrganization("primary-route");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  environmentId = project.mainEnvironmentId;
});

afterAll(async () => {
  if (redisUrl) await closeQueues();
});

describe.skipIf(!redisUrl)("one primary route per resource", () => {
  it("two domains added at once to a service with none: exactly one is primary", async () => {
    const counts: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const resourceId = await createWebService();
      await Promise.all([add(resourceId), add(resourceId)]);
      counts.push((await primaries(resourceId)).length);
    }
    expect(counts).toEqual(Array.from({ length: ROUNDS }, () => 1));
  });

  it("two routes promoted at once: exactly one is primary, the one promoted last", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const resourceId = await createWebService();
      const first = await add(resourceId);
      const second = await add(resourceId);
      const third = await add(resourceId);
      const [a, b] = await Promise.all([
        promotePrimaryRoute(resourceId, second),
        promotePrimaryRoute(resourceId, third),
      ]);
      expect([a?.isPrimary, b?.isPrimary]).toEqual([true, true]);
      const live = await primaries(resourceId);
      expect(live).toHaveLength(1);
      const [firstRow] = await db.select().from(proxyRoute).where(eq(proxyRoute.id, first));
      expect(firstRow?.isPrimary).toBe(false);
    }
  });

  it("promoting another resource's route changes nothing", async () => {
    const mine = await createWebService();
    const theirs = await createWebService();
    await add(mine);
    const foreign = await add(theirs);
    expect(await promotePrimaryRoute(mine, foreign)).toBeUndefined();
    expect(await primaries(mine)).toHaveLength(1);
    expect(await primaries(theirs)).toHaveLength(1);
  });

  it("the schema refuses a second primary written past the helpers", async () => {
    const resourceId = await createWebService();
    await add(resourceId);
    const second = await Result.tryPromise({
      try: () =>
        db.insert(proxyRoute).values({
          projectId,
          resourceId,
          type: "http",
          domain: `raw-${uniq()}.example.org`,
          upstreamHost: "od-raw",
          upstreamPort: 8080,
          protocol: "http",
          isPrimary: true,
        }),
      catch: (cause) => cause,
    });
    expect(second.isErr() && isUniqueViolation(second.error)).toBe(true);
  });
});
