/**
 * A domain write answers once the route is durable, not once
 * Caddy has reloaded.
 *
 * `service.domains.add` used to take over 20 s while the proxy_route
 * row was written in milliseconds; the handler sat on `reconcile()` waiting
 * for Caddy's /load. Here the handlers run as shipped against a migrated
 * Postgres, and only the edge's admin API (caddy/client.ts) is stood in for,
 * so a test decides when the reload lands and whether Caddy accepts it.
 * Everything between, the reload queue, the reconcile, and the settle that
 * records the outcome on the route row, is the real code.
 */
import type { OrganizationId, ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type LoadResult = { ok: true } | { ok: false; error: string };

const edge = vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: the post-add redeploy must fail fast on an unreachable Docker */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-domain-edge-reload.sock";
  /** Every config handed to Caddy's /load, in order. */
  const loads: string[] = [];
  /** How the next /load answers. A test swaps it to hold or fail a reload. */
  let answer: (caddyfile: string) => Promise<LoadResult> = async () => ({ ok: true });
  return {
    loads,
    answerWith(next: (caddyfile: string) => Promise<LoadResult>) {
      answer = next;
    },
    load(caddyfile: string) {
      loads.push(caddyfile);
      return answer(caddyfile);
    },
  };
});

vi.mock("../../../caddy/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../caddy/client")>()),
  adaptCaddyfile: async () => ({ ok: true, json: {} }),
  loadCaddyfile: (caddyfile: string) => edge.load(caddyfile),
  readCaddyConfig: async () => Result.err(new Error("no admin API in this test")),
}));

// Plain docker: the reconcile re-attaches the edge to project networks first.
// There is no Docker here, and that step is not what is under test.
vi.mock("../../../swarm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../swarm/client")>()),
  ensureEdgeOnProjectNetworks: async () => undefined,
}));

// A Cloudflare-proxied answer serves at once on a single-org install and
// stays on `tls internal`, so the route is live without an ACME email.
vi.mock("../../../lib/domain-reachability", () => ({
  checkDomainReachability: async () => ({ state: "proxied", addresses: ["104.16.0.1"] }),
}));
vi.mock("../domain-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain-rules")>()),
  isMultiOrgInstall: async () => false,
}));

const { reconcile } = await import("../../../caddy");
const { claimEdgeOwnership, edgeSyncIdle, requestEdgeSync } =
  await import("../../../caddy/edge-sync");
const { addServiceDomain } = await import("../domains");
const { setServiceDomainEnabled } = await import("../domains-enabled");
const { createServiceRecord } = await import("../queries/service");
const { seedOrganization, seedProject, uniq } = await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/domain-edge-reload" });

let organizationId: OrganizationId;
let projectId: ProjectId;
let resourceId: ResourceId;

/** A load that waits until the test lets it finish. */
function heldLoad(): { release: (answer: LoadResult) => void } {
  let release: (answer: LoadResult) => void = () => undefined;
  const held = new Promise<LoadResult>((resolve) => {
    release = resolve;
  });
  edge.answerWith(() => held);
  return { release: (answer) => release(answer) };
}

async function readRoute(id: ProxyRouteId) {
  const [row] = await db.select().from(proxyRoute).where(eq(proxyRoute.id, id));
  if (!row) throw new Error(`route ${id} vanished`);
  return row;
}

async function add(domain: string) {
  const added = await addServiceDomain({ organizationId, projectId, resourceId, domain }, log);
  if (added.isErr()) throw added.error;
  return { ...added.value, id: idSchema.proxyRoute.parse(added.value.id) };
}

beforeAll(async () => {
  // This process stands in for the server, the one that reaches the edge.
  claimEdgeOwnership();
  organizationId = await seedOrganization("domain-edge");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  const name = `web-${uniq()}`;
  const record = await createServiceRecord({
    projectId,
    environmentId: project.mainEnvironmentId,
    name,
    image: "nginx:alpine",
    internalHostname: name,
    serviceName: `od-${name}`,
    networkName: `od-net-${uniq()}`,
    stackId: null,
    composeService: null,
    ports: [{ containerPort: 8080, appProtocol: "http", isPrimary: true }],
  });
  resourceId = record.resource.id;
});

beforeEach(async () => {
  await edgeSyncIdle();
  edge.answerWith(async () => ({ ok: true }));
  edge.loads.length = 0;
});

describe("service.domains.add and the edge reload", () => {
  it("answers once the route is written, while the reload is still running", async () => {
    const reload = heldLoad();
    const domain = `app-${uniq()}.example.org`;

    // The old handler awaited the reload, so with Caddy holding /load this
    // never answered. Two seconds is generous for a few row writes.
    const answered = await Promise.race([
      add(domain),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
    if (!answered) {
      // Let the stuck add finish so the next test does not inherit it.
      reload.release({ ok: true });
      await edgeSyncIdle();
    }
    expect(answered, "the add waited on the Caddy reload").not.toBeNull();
    if (!answered) return;

    expect(answered.status).toBe("live");
    expect(answered.edgeState).toBe("pending");
    expect((await readRoute(answered.id)).edgeState).toBe("pending");
    // The reload did start, behind the response, and carries the new host.
    await vi.waitFor(() => expect(edge.loads.some((c) => c.includes(domain))).toBe(true));

    reload.release({ ok: true });
    await edgeSyncIdle();
    const settled = await readRoute(answered.id);
    expect(settled.edgeState).toBe("synced");
    expect(settled.edgeError).toBeNull();
  });

  it("records a reload Caddy refuses on the route, and a later reload clears it", async () => {
    edge.answerWith(async () => ({ ok: false, error: "loading new config: boom" }));
    const route = await add(`fail-${uniq()}.example.org`);
    await edgeSyncIdle();

    const failed = await readRoute(route.id);
    expect(failed.edgeState).toBe("failed");
    expect(failed.edgeError).toContain("boom");

    // The next write to the route starts over: pending, until its reload lands.
    edge.answerWith(async () => ({ ok: true }));
    const paused = await setServiceDomainEnabled(
      { organizationId, projectId, resourceId, routeId: route.id, enabled: false },
      log,
    );
    expect(paused.isOk() && paused.value.edgeState).toBe("pending");
    await edgeSyncIdle();
    expect((await readRoute(route.id)).edgeState).toBe("synced");
  });

  it("a retry clears a failed route without a new write (the edge watch path)", async () => {
    edge.answerWith(async () => ({ ok: false, error: "loading new config: boom" }));
    const route = await add(`retry-${uniq()}.example.org`);
    await edgeSyncIdle();
    expect((await readRoute(route.id)).edgeState).toBe("failed");

    edge.answerWith(async () => ({ ok: true }));
    const retried = await requestEdgeSync();
    expect(retried.isOk()).toBe(true);
    const cleared = await readRoute(route.id);
    expect(cleared.edgeState).toBe("synced");
    expect(cleared.edgeError).toBeNull();
  });

  it("a reconcile that throws marks what it carried failed and still throws", async () => {
    edge.answerWith(async () => ({ ok: true }));
    const route = await add(`throw-${uniq()}.example.org`);
    await edgeSyncIdle();
    expect((await readRoute(route.id)).edgeState).toBe("synced");

    await setServiceDomainEnabled(
      { organizationId, projectId, resourceId, routeId: route.id, enabled: false },
      log,
    );
    // Let the queued reload of the pause finish first, then hold the row
    // pending by hand so the throwing reconcile below is the one to carry it.
    await edgeSyncIdle();
    await db.update(proxyRoute).set({ edgeState: "pending" }).where(eq(proxyRoute.id, route.id));
    edge.answerWith(async () => {
      throw new Error("admin socket vanished");
    });
    await expect(reconcile(undefined, { recordFailures: true })).rejects.toThrow(
      "admin socket vanished",
    );
    const failed = await readRoute(route.id);
    expect(failed.edgeState).toBe("failed");
    expect(failed.edgeError).toContain("admin socket vanished");
  });
});

describe("concurrent route writes and one in-flight reload", () => {
  it("a write landing mid-reload stays pending for the reload queued behind it", async () => {
    const first = heldLoad();
    const a = await add(`a-${uniq()}.example.org`);
    await vi.waitFor(() => expect(edge.loads).toHaveLength(1));

    // B is added and A paused while A's reload is still inside Caddy: both are
    // written after that reload read the routes.
    const second = heldLoad();
    const b = await add(`b-${uniq()}.example.org`);
    const paused = await setServiceDomainEnabled(
      { organizationId, projectId, resourceId, routeId: a.id, enabled: false },
      log,
    );
    expect(paused.isOk()).toBe(true);
    expect(edge.loads[0]).not.toContain(b.domain);

    // Reload 1 lands. It carried A's earlier revision, so it must not mark A
    // synced: the pause it never saw is still on its way.
    first.release({ ok: true });
    await vi.waitFor(() => expect(edge.loads).toHaveLength(2));
    expect((await readRoute(a.id)).edgeState).toBe("pending");
    expect((await readRoute(b.id)).edgeState).toBe("pending");

    // Exactly one follow-up served both writes, and it carries both.
    expect(edge.loads[1]).toContain(b.domain);
    expect(edge.loads[1]).not.toContain(a.domain);
    second.release({ ok: true });
    await edgeSyncIdle();
    expect(edge.loads).toHaveLength(2);
    expect((await readRoute(a.id)).edgeState).toBe("synced");
    expect((await readRoute(b.id)).edgeState).toBe("synced");
  });
});
