/**
 * Who reports health, and from when.
 *
 *  - The control plane reports from boot. Its bootstrap localhost row used to
 *    be born on the first `server.list`, so an install nobody had opened yet
 *    (or one set up over the API) had no row to sample and reported nothing
 *    until someone did.
 *  - A worker joined on the plain-Docker runtime reports too. The worker is a
 *    swarm node under either runtime, so the reconciler deploys the global
 *    agent wherever this daemon is a swarm manager, not only when
 *    DEPLOY_RUNTIME=swarm. A single-host install with no swarm is left alone.
 *  - The agent's own container is not a workload: "Containers running" on the
 *    plain-Docker runtime does not count it.
 *
 * The local Docker daemon is a fake daemon on a unix socket; the host sampler
 * is stubbed (its readings are host-health's own tests' business).
 */
import { db } from "@otterdeploy/db";
import { server, serverHealthSample } from "@otterdeploy/db/schema/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type FakeDockerd, startFakeDockerd } from "../../__tests__/fake-swarm-daemon";
import { seedOrganization } from "../../__tests__/postgres-seed";
import { getServerStats } from "../../routers/server/stats";
import { sampleLocalHost, startHealthAgentReconciler } from "../agent-service";

const { socketPath } = vi.hoisted(() => {
  const path = `/tmp/od-agent-dockerd-${process.pid}.sock`;
  /* oxlint-disable node/no-process-env -- test env boundary: the Docker client dials the fake daemon, the install runs the plain-Docker runtime (the installer default), and the agent's ingest URL is pinned so no platform settings row is needed */
  process.env.DOCKER_HOST = `unix://${path}`;
  process.env.DEPLOY_RUNTIME = "docker";
  process.env.HEALTH_AGENT_INGEST_URL_OVERRIDE = "http://10.0.0.1:3000/api/agent/health";
  /* oxlint-enable node/no-process-env */
  return { socketPath: path };
});

vi.mock("../host-health", () => ({
  getHostHealth: async () => ({
    sampledAt: "2026-10-08T04:30:00Z",
    memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 2 * 1024 ** 3 },
  }),
}));

let dockerd: FakeDockerd;

beforeAll(() => {
  dockerd = startFakeDockerd(socketPath);
});

afterAll(() => {
  dockerd.stop();
});

beforeEach(() => {
  dockerd.state.swarm = true;
  dockerd.state.infoFails = false;
  dockerd.state.services = [];
  dockerd.state.containers = [];
  dockerd.state.seen = [];
});

/** Start the reconciler, wait for its first (immediate) pass to send
 *  `request`, give the pass a beat to finish, then stop the timer. */
async function reconcileUntil(request: string): Promise<void> {
  const stop = startHealthAgentReconciler();
  try {
    await vi.waitFor(
      () => {
        if (!dockerd.state.seen.includes(request))
          throw new Error(`no ${request} yet: ${dockerd.state.seen.join(", ")}`);
      },
      { timeout: 5_000, interval: 20 },
    );
    await Bun.sleep(100);
  } finally {
    stop();
  }
}

describe("control plane health from boot", () => {
  it("an org nobody has listed servers for gets its localhost row and a sample on the first pass", async () => {
    const org = await seedOrganization("health-boot");
    // Nothing has called server.list: no row exists yet.
    expect(
      await db
        .select({ id: server.id })
        .from(server)
        .where(and(eq(server.organizationId, org), eq(server.host, "127.0.0.1"))),
    ).toEqual([]);

    await sampleLocalHost();

    const [row] = await db
      .select({ id: server.id, labels: server.labels })
      .from(server)
      .where(and(eq(server.organizationId, org), eq(server.host, "127.0.0.1")));
    expect(row?.labels).toContain("bootstrap");
    if (!row) return;
    const samples = await db
      .select({ serverId: serverHealthSample.serverId })
      .from(serverHealthSample)
      .where(eq(serverHealthSample.serverId, row.id));
    expect(samples).toEqual([{ serverId: row.id }]);
  });

  it("a second pass reuses the row instead of adding another", async () => {
    const org = await seedOrganization("health-boot-twice");
    await sampleLocalHost();
    await sampleLocalHost();
    const rows = await db
      .select({ id: server.id })
      .from(server)
      .where(and(eq(server.organizationId, org), eq(server.host, "127.0.0.1")));
    expect(rows).toHaveLength(1);
  });
});

describe("health agent on the plain-Docker runtime", () => {
  it("deploys the global agent when this daemon manages a swarm (a worker has joined)", async () => {
    await reconcileUntil("POST /services/create");
    expect(dockerd.state.services.map((s) => s.Spec.Name)).toEqual(["otterdeploy-health-agent"]);
  });

  it("leaves a single-host install with no swarm alone: no service, no swarm init", async () => {
    dockerd.state.swarm = false;
    await reconcileUntil("GET /info");
    expect(dockerd.state.seen).toEqual(["GET /info"]);
    expect(dockerd.state.services).toEqual([]);
  });

  it("a daemon that cannot say whether it is a swarm manager fails the pass without touching services", async () => {
    dockerd.state.infoFails = true;
    await reconcileUntil("GET /info");
    expect(dockerd.state.seen).toEqual(["GET /info"]);
    expect(dockerd.state.services).toEqual([]);
  });

  it("does not count the agent's own container as a running workload", async () => {
    const org = await seedOrganization("health-agent-stats");
    await sampleLocalHost();
    dockerd.state.containers = [
      {
        Id: "app-1",
        Names: ["/od-shop-web"],
        Labels: { "otterdeploy.managed": "true", "otterdeploy.project": "shop" },
      },
      {
        Id: "agent-1",
        Names: ["/otterdeploy-health-agent.abc.1"],
        Labels: { "otterdeploy.managed": "true", "otterdeploy.role": "health-agent" },
      },
    ];
    const stats = await getServerStats({ organizationId: org });
    expect(stats.cluster.tasksRunning).toBe(1);
  });
});
