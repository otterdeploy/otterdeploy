import { describe, expect, it } from "vite-plus/test";

import type { TargetContainer, TargetDatabase, TargetServer } from "./pick-targets";

import { buildPickerTargets, projectFacets } from "./pick-targets";

function container(over: Partial<TargetContainer> = {}): TargetContainer {
  return {
    containerId: "c".repeat(64),
    name: "store-web",
    image: "registry/store-web:latest",
    state: "running",
    resourceType: "service",
    projectSlug: "store",
    projectName: "Store",
    serviceResourceId: "res_svc1",
    serviceName: "store-web",
    replicaSlot: "1",
    ...over,
  };
}

describe("buildPickerTargets", () => {
  it("marks replicas only when a service is actually scaled", () => {
    const single = buildPickerTargets({
      containers: [container()],
      databases: [],
      servers: [],
    });
    expect(single[0]?.qualifier).toBeNull();

    const scaled = buildPickerTargets({
      containers: [
        container({ containerId: "a".repeat(64), replicaSlot: "1" }),
        container({ containerId: "b".repeat(64), replicaSlot: "2" }),
      ],
      databases: [],
      servers: [],
    });
    expect(scaled.map((t) => t.qualifier)).toEqual(["replica 1", "replica 2"]);
  });

  it("counts each replica as its own directly-selectable destination", () => {
    const targets = buildPickerTargets({
      containers: [
        container({ containerId: "a".repeat(64), replicaSlot: "1" }),
        container({ containerId: "b".repeat(64), replicaSlot: "2" }),
      ],
      databases: [],
      servers: [],
    });
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.source.kind === "container")).toBe(true);
  });

  it("opens a database resource as a shell in its own container", () => {
    const db: TargetDatabase = {
      resourceId: "res_pg1",
      name: "orders",
      engine: "postgres",
      projectSlug: "store",
      projectName: "Store",
    };
    const targets = buildPickerTargets({
      containers: [
        container({
          containerId: "d".repeat(64),
          resourceType: "postgres",
          serviceResourceId: "res_pg1",
          serviceName: "otterdeploy-pg-orders",
          replicaSlot: null,
        }),
      ],
      databases: [db],
      servers: [],
    });

    // One row, not two — the container and the resource are the same box.
    expect(targets).toHaveLength(1);
    const [row] = targets;
    expect(row?.name).toBe("orders");
    expect(row?.tag).toBe("postgres");
    expect(row?.unavailable).toBeNull();
    expect(row?.source).toMatchObject({ kind: "container", containerId: "d".repeat(64) });
  });

  it("says why a database with no running container can't be opened", () => {
    const targets = buildPickerTargets({
      containers: [],
      databases: [
        {
          resourceId: "res_pg1",
          name: "orders",
          engine: "postgres",
          projectSlug: "store",
          projectName: "Store",
        },
      ],
      servers: [],
    });
    expect(targets[0]?.unavailable).toBe("no running container");
  });

  it("still lists a database container that no resource row claims", () => {
    const targets = buildPickerTargets({
      containers: [
        container({
          containerId: "e".repeat(64),
          resourceType: "redis",
          serviceResourceId: null,
          serviceName: "cache",
        }),
      ],
      databases: [],
      servers: [],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ group: "database", name: "cache", tag: "redis" });
  });

  it("routes the bootstrap node to the local host shell and flags the rest", () => {
    const servers: TargetServer[] = [
      { id: "s1", name: "localhost", host: "127.0.0.1", labels: ["bootstrap"] },
      { id: "s2", name: "worker-1", host: "10.0.0.4", labels: [] },
    ];
    const targets = buildPickerTargets({ containers: [], databases: [], servers });
    const local = targets.find((t) => t.name === "localhost");
    const remote = targets.find((t) => t.name === "worker-1");

    expect(local?.source).toMatchObject({ kind: "ssh", mode: "local" });
    expect(local?.pending).toBe(false);
    expect(remote?.source).toMatchObject({ kind: "ssh", mode: "remote" });
    expect(remote?.pending).toBe(true);
  });

  it("flags a container that stopped between discovery and the click", () => {
    const targets = buildPickerTargets({
      containers: [container({ state: "exited" })],
      databases: [],
      servers: [],
    });
    expect(targets[0]?.unavailable).toBe("container is exited");
  });

  it("keeps groups contiguous and ordered within each", () => {
    const targets = buildPickerTargets({
      containers: [
        container({ containerId: "b".repeat(64), serviceName: "web", replicaSlot: null }),
        container({ containerId: "a".repeat(64), serviceName: "api", replicaSlot: null }),
      ],
      databases: [],
      servers: [{ id: "s1", name: "localhost", host: "127.0.0.1", labels: ["bootstrap"] }],
    });
    expect(targets.map((t) => t.group)).toEqual(["service", "service", "server"]);
    expect(targets.slice(0, 2).map((t) => t.name)).toEqual(["api", "web"]);
  });
});

describe("projectFacets", () => {
  it("counts targets per project, most populated first", () => {
    const targets = buildPickerTargets({
      containers: [
        container({ containerId: "a".repeat(64), projectSlug: "store", serviceName: "web" }),
        container({ containerId: "b".repeat(64), projectSlug: "store", serviceName: "api" }),
        container({ containerId: "c".repeat(64), projectSlug: "helio", serviceName: "web" }),
      ],
      databases: [],
      servers: [{ id: "s1", name: "localhost", host: "127.0.0.1", labels: ["bootstrap"] }],
    });

    // Servers belong to no project, so they don't appear as a facet.
    expect(projectFacets(targets)).toEqual([
      { slug: "store", count: 2 },
      { slug: "helio", count: 1 },
    ]);
  });
});
