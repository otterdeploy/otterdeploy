/**
 * Lane resolution is deliberately conservative: the ONLY way off the default
 * lane is a project whose placed resources point at exactly one build server
 * with a valid lane. Everything ambiguous, invalid, or broken must resolve to
 * "default", because a wrong lane routes a build to a queue no builder may be
 * draining (a silently stuck deploy) while "default" merely shares a queue.
 */

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Typed so the mocked drizzle chain returns a known row shape: keeps the
// mock free of both `as unknown` laundering and unsafe-any returns.
const selectRows = vi.fn<() => Promise<Array<{ serverId: string; buildLane: string | null }>>>();

// Only the chain shape resolveBuildLane calls:
// select().from().innerJoin().where() → rows. The WHERE predicate (buildServer
// + lane not null) is treated as pre-applied; tests provide already-filtered
// rows, which is what the query hands back in production too.
vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => selectRows(),
        }),
      }),
    }),
  },
}));

import { resolveBuildLane } from "../build-lane";

const projectId = createId(ID_PREFIX.project);

function withRows(rows: Array<{ serverId: string; buildLane: string | null }>) {
  selectRows.mockResolvedValue(rows);
}

beforeEach(() => {
  selectRows.mockReset();
});

describe("resolveBuildLane", () => {
  test("no placed build server → default", async () => {
    withRows([]);
    expect(await resolveBuildLane(projectId)).toBe("default");
  });

  test("exactly one build server with a lane → that lane", async () => {
    withRows([{ serverId: "srv_1", buildLane: "fast" }]);
    expect(await resolveBuildLane(projectId)).toBe("fast");
  });

  test("several resources on the SAME build server still resolve to its lane", async () => {
    withRows([
      { serverId: "srv_1", buildLane: "fast" },
      { serverId: "srv_1", buildLane: "fast" },
      { serverId: "srv_1", buildLane: "fast" },
    ]);
    expect(await resolveBuildLane(projectId)).toBe("fast");
  });

  test("placements split across two lane-bearing build servers are ambiguous → default", async () => {
    withRows([
      { serverId: "srv_1", buildLane: "fast" },
      { serverId: "srv_2", buildLane: "slow" },
    ]);
    expect(await resolveBuildLane(projectId)).toBe("default");
  });

  test("a stored lane that fails name validation → default", async () => {
    withRows([{ serverId: "srv_1", buildLane: "Not A Lane!" }]);
    expect(await resolveBuildLane(projectId)).toBe("default");
  });

  test("a lane explicitly named 'default' resolves to default (not a duplicate queue)", async () => {
    withRows([{ serverId: "srv_1", buildLane: "default" }]);
    expect(await resolveBuildLane(projectId)).toBe("default");
  });

  test("a lookup failure degrades to default rather than blocking the enqueue", async () => {
    selectRows.mockRejectedValue(new Error("db down"));
    expect(await resolveBuildLane(projectId)).toBe("default");
  });
});
