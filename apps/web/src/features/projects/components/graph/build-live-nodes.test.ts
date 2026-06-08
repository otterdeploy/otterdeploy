import { describe, expect, it } from "vitest";

import { buildLiveNodes, type PendingByName } from "./build-live-nodes";

const noTasks = new Map();

describe("buildLiveNodes ghost synthesis", () => {
  it("appends a ghost node for each staged create", () => {
    const pending: PendingByName = {
      creates: [
        { resource: "service", name: "web" },
        { resource: "database", name: "db" },
      ],
      marker: new Map(),
    };
    const nodes = buildLiveNodes([], noTasks, pending);
    expect(nodes).toHaveLength(2);

    const web = nodes.find((n) => n.id === "pending:service:web");
    expect(web).toMatchObject({
      type: "resource",
      data: { kind: "service", name: "web", pending: "create", description: "New service (pending)" },
    });

    const db = nodes.find((n) => n.id === "pending:database:db");
    expect(db).toMatchObject({
      data: { kind: "database", name: "db", pending: "create", description: "New database (pending)" },
    });
  });

  it("returns no nodes when there are no resources and no pending creates", () => {
    expect(buildLiveNodes([], noTasks)).toEqual([]);
    expect(
      buildLiveNodes([], noTasks, { creates: [], marker: new Map() }),
    ).toEqual([]);
  });
});
