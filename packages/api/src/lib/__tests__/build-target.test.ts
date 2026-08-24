/**
 * Build-target resolution is deliberately conservative: the ONLY ways off the
 * default lane are an explicit assignment (service, then project) or the
 * legacy placement inference. Everything ambiguous, invalid, or broken must
 * resolve to "default", because a wrong lane routes a build to a queue no
 * builder may be draining — a silently stuck deploy — while "default" merely
 * shares a queue.
 */

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

interface PlacementRow {
  serverId: string;
  name: string;
  lane: string | null;
}

/** Rows for the legacy placement join. */
const placementRows = vi.fn<() => Promise<PlacementRow[]>>();
/** Rows for each `select().from().where().limit()` lookup, in call order:
 *  serviceResource → project → server. Tests queue exactly what they need. */
const limitRows = vi.fn<() => Promise<Array<Record<string, unknown>>>>();

// Two chain shapes are used by the module:
//   select().from().where().limit()        → the assignment + server lookups
//   select().from().innerJoin().where()    → the legacy placement join
const hasConsumer = vi.fn<() => Promise<boolean>>();
vi.mock("@otterdeploy/jobs/queues", () => ({ laneHasConsumer: () => hasConsumer() }));

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => limitRows() }),
        innerJoin: () => ({ where: () => placementRows() }),
      }),
    }),
  },
}));

import { buildTargetBlocker, buildTargetUnavailable, resolveBuildTarget } from "../build-target";

const projectId = createId(ID_PREFIX.project);
const resourceId = createId(ID_PREFIX.resource);
const serverId = createId(ID_PREFIX.server);

/** Queue the `.limit()` results in the order the module asks for them. */
function queueLookups(...results: Array<Array<Record<string, unknown>>>) {
  limitRows.mockReset();
  for (const r of results) limitRows.mockResolvedValueOnce(r);
  limitRows.mockResolvedValue([]);
}

const buildServer = (over: Record<string, unknown> = {}) => [
  { id: serverId, name: "builder-01", lane: "fast", isBuild: true, ...over },
];

beforeEach(() => {
  hasConsumer.mockReset();
  hasConsumer.mockResolvedValue(true);
  placementRows.mockReset();
  placementRows.mockResolvedValue([]);
  limitRows.mockReset();
  limitRows.mockResolvedValue([]);
});

describe("resolveBuildTarget — explicit assignment", () => {
  test("a service's own build server wins", async () => {
    queueLookups([{ buildServerId: serverId }], buildServer());
    const target = await resolveBuildTarget(projectId, resourceId);
    expect(target).toMatchObject({ lane: "fast", reason: "service", serverName: "builder-01" });
  });

  test("falls back to the project's build server", async () => {
    // service row has none → project row does → server lookup
    queueLookups([{ buildServerId: null }], [{ buildServerId: serverId }], buildServer());
    const target = await resolveBuildTarget(projectId, resourceId);
    expect(target).toMatchObject({ lane: "fast", reason: "project" });
  });

  test("no assignment anywhere → default lane", async () => {
    queueLookups([{ buildServerId: null }], [{ buildServerId: null }]);
    const target = await resolveBuildTarget(projectId, resourceId);
    expect(target).toMatchObject({ lane: "default", reason: "default", serverId: null });
  });

  test("without a resourceId only the project is consulted", async () => {
    queueLookups([{ buildServerId: serverId }], buildServer());
    const target = await resolveBuildTarget(projectId);
    expect(target.reason).toBe("project");
  });

  test("a server that is no longer a build server degrades to default", async () => {
    queueLookups([{ buildServerId: serverId }], buildServer({ isBuild: false }));
    expect((await resolveBuildTarget(projectId, resourceId)).lane).toBe("default");
  });

  test("an assignment pointing at a deleted server degrades to default", async () => {
    queueLookups([{ buildServerId: serverId }], []);
    expect((await resolveBuildTarget(projectId, resourceId)).lane).toBe("default");
  });

  test("a build server with no lane still builds, on the default queue", async () => {
    queueLookups([{ buildServerId: serverId }], buildServer({ lane: null }));
    const target = await resolveBuildTarget(projectId, resourceId);
    // Named so the log is honest about where it ran, even though the queue is shared.
    expect(target).toMatchObject({ lane: "default", serverName: "builder-01" });
    expect(target.serverId).toBe(serverId);
  });

  test("an invalid lane name never reaches BullMQ", async () => {
    queueLookups([{ buildServerId: serverId }], buildServer({ lane: "NOT VALID" }));
    expect((await resolveBuildTarget(projectId, resourceId)).lane).toBe("default");
  });

  test("a lookup failure degrades to default rather than throwing", async () => {
    limitRows.mockReset();
    limitRows.mockRejectedValue(new Error("db down"));
    expect((await resolveBuildTarget(projectId, resourceId)).lane).toBe("default");
  });
});

describe("resolveBuildTarget — legacy placement inference", () => {
  test("one placed build server with a lane still routes there", async () => {
    queueLookups([{ buildServerId: null }], [{ buildServerId: null }]);
    placementRows.mockResolvedValue([{ serverId, name: "old-builder", lane: "fast" }]);
    const target = await resolveBuildTarget(projectId, resourceId);
    expect(target).toMatchObject({ lane: "fast", reason: "placement" });
  });

  test("resources split across two build servers stay on default", async () => {
    queueLookups([{ buildServerId: null }], [{ buildServerId: null }]);
    placementRows.mockResolvedValue([
      { serverId, name: "a", lane: "fast" },
      { serverId: createId(ID_PREFIX.server), name: "b", lane: "slow" },
    ]);
    expect((await resolveBuildTarget(projectId, resourceId)).lane).toBe("default");
  });

  test("an explicit assignment beats placement", async () => {
    queueLookups([{ buildServerId: serverId }], buildServer({ lane: "assigned" }));
    placementRows.mockResolvedValue([{ serverId, name: "old", lane: "inferred" }]);
    const target = await resolveBuildTarget(projectId, resourceId);
    expect(target).toMatchObject({ lane: "assigned", reason: "service" });
  });
});

describe("buildTargetBlocker", () => {
  test("building where you run needs no registry", () => {
    expect(
      buildTargetBlocker({ target: { serverId: null, serverName: null }, imageRepository: null }),
    ).toBeNull();
  });

  test("a dedicated build server with an image target is fine", () => {
    expect(
      buildTargetBlocker({
        target: { serverId, serverName: "builder-01" },
        imageRepository: "ghcr.io/acme/web",
      }),
    ).toBeNull();
  });

  test("a dedicated build server without one is blocked, and says why", () => {
    const reason = buildTargetBlocker({
      target: { serverId, serverName: "builder-01" },
      imageRepository: null,
    });
    expect(reason).toContain("builder-01");
    expect(reason).toContain("could not pull");
  });

  test("whitespace is not an image target", () => {
    expect(
      buildTargetBlocker({ target: { serverId, serverName: "b" }, imageRepository: "   " }),
    ).not.toBeNull();
  });
});

describe("buildTargetUnavailable", () => {
  const target = {
    serverId,
    serverName: "builder-01",
    lane: "fast",
    reason: "service" as const,
  };

  test("the default lane is always available (there is no server to check)", async () => {
    const reason = await buildTargetUnavailable({
      serverId: null,
      serverName: null,
      lane: "default",
      reason: "default",
    });
    expect(reason).toBeNull();
  });

  test("a ready server with a live builder is available", async () => {
    queueLookups([{ status: "ready", provisionStatus: "ready" }]);
    expect(await buildTargetUnavailable(target)).toBeNull();
  });

  test("a server still provisioning is reported, not queued into", async () => {
    queueLookups([{ status: "ready", provisionStatus: "provisioning" }]);
    const reason = await buildTargetUnavailable(target);
    expect(reason).toContain("builder-01");
    expect(reason).toContain("isn't ready");
  });

  test("a deleted server is reported", async () => {
    queueLookups([]);
    expect(await buildTargetUnavailable(target)).toContain("no longer exists");
  });

  test("a lane nobody drains is reported, naming BUILDER_LANE", async () => {
    queueLookups([{ status: "ready", provisionStatus: "ready" }]);
    hasConsumer.mockResolvedValue(false);
    const reason = await buildTargetUnavailable(target);
    expect(reason).toContain("queue forever");
    expect(reason).toContain("BUILDER_LANE=fast");
  });

  test("a check that cannot run reports available, never blocking a good deploy", async () => {
    limitRows.mockReset();
    limitRows.mockRejectedValue(new Error("db down"));
    expect(await buildTargetUnavailable(target)).toBeNull();
  });
});
