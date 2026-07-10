import { describe, expect, test } from "vite-plus/test";

import type { ResourceInfo, StackClaim, VolumeClaim, VolumeContainerRef } from "../mapping";

import { buildVolumeMappingIndex, mapVolume } from "../mapping";

const pgResource: ResourceInfo = {
  resourceId: "res_pg1",
  resourceName: "main-db",
  resourceType: "database",
  projectId: "prj_1",
  projectSlug: "helio",
  engine: "postgres",
};

const svcResource: ResourceInfo = {
  resourceId: "res_svc1",
  resourceName: "web",
  resourceType: "service",
  projectId: "prj_1",
  projectSlug: "helio",
  engine: null,
};

const pgClaim: VolumeClaim = {
  volumeName: "otterdeploy-pgdata-helio-main_db",
  resourceId: "res_pg1",
  resourceName: "main-db",
  resourceType: "database",
  projectId: "prj_1",
  projectSlug: "helio",
  engine: "postgres",
};

const svcMountClaim: VolumeClaim = {
  volumeName: "web-uploads",
  resourceId: "res_svc1",
  resourceName: "web",
  resourceType: "service",
  projectId: "prj_1",
  projectSlug: "helio",
  engine: null,
};

const stack: StackClaim = {
  stackName: "helio-monitoring",
  resourceId: "res_stack1",
  resourceName: "monitoring",
  projectId: "prj_1",
  projectSlug: "helio",
};

function container(partial: Partial<VolumeContainerRef>): VolumeContainerRef {
  return {
    id: "c_" + Math.random().toString(36).slice(2, 8),
    name: "container",
    labels: {},
    volumeNames: [],
    ...partial,
  };
}

function index(input?: {
  containers?: VolumeContainerRef[];
  claims?: VolumeClaim[];
  stackClaims?: StackClaim[];
  resources?: ResourceInfo[];
}) {
  return buildVolumeMappingIndex({
    containers: input?.containers ?? [],
    claims: input?.claims ?? [pgClaim, svcMountClaim],
    stackClaims: input?.stackClaims ?? [stack],
    resources: input?.resources ?? [pgResource, svcResource],
  });
}

describe("mapVolume — container label resolution", () => {
  test("mounting container with otterdeploy.resource.id resolves via 'container'", () => {
    const idx = index({
      containers: [
        container({
          name: "otterdeploy-pg-helio-main_db.1.abc",
          labels: { "otterdeploy.resource.id": "res_pg1" },
          volumeNames: ["otterdeploy-pgdata-helio-main_db"],
        }),
      ],
    });
    const result = mapVolume("otterdeploy-pgdata-helio-main_db", idx);
    expect(result.refCount).toBe(1);
    expect(result.containerNames).toEqual(["otterdeploy-pg-helio-main_db.1.abc"]);
    expect(result.orphan).toBe(false);
    expect(result.attachedTo).toHaveLength(1);
    expect(result.attachedTo[0]).toMatchObject({
      resourceId: "res_pg1",
      resourceType: "database",
      engine: "postgres",
      via: "container",
    });
  });

  test("container link wins over a name-convention claim for the same resource", () => {
    const idx = index({
      containers: [
        container({
          labels: { "otterdeploy.resource.id": "res_pg1" },
          volumeNames: ["otterdeploy-pgdata-helio-main_db"],
        }),
      ],
    });
    const result = mapVolume("otterdeploy-pgdata-helio-main_db", idx);
    // Claim for the same resource must not produce a duplicate attachment.
    expect(result.attachedTo).toHaveLength(1);
    expect(result.attachedTo[0]?.via).toBe("container");
  });

  test("container with a resource id outside the org directory yields no chip but counts as in use", () => {
    const idx = index({
      containers: [
        container({
          labels: { "otterdeploy.resource.id": "res_other_org" },
          volumeNames: ["mystery-data"],
        }),
      ],
    });
    const result = mapVolume("mystery-data", idx);
    expect(result.refCount).toBe(1);
    expect(result.attachedTo).toHaveLength(0);
    expect(result.orphan).toBe(false);
  });

  test("compose task container resolves through com.docker.stack.namespace", () => {
    const idx = index({
      containers: [
        container({
          labels: { "com.docker.stack.namespace": "helio-monitoring" },
          volumeNames: ["helio-monitoring_grafana-data"],
        }),
      ],
    });
    const result = mapVolume("helio-monitoring_grafana-data", idx);
    expect(result.attachedTo).toEqual([
      expect.objectContaining({
        resourceId: "res_stack1",
        resourceType: "compose",
        via: "container",
      }),
    ]);
  });
});

describe("mapVolume — passive claims", () => {
  test("database volume with no container is claimed by naming convention", () => {
    const result = mapVolume("otterdeploy-pgdata-helio-main_db", index());
    expect(result.refCount).toBe(0);
    expect(result.orphan).toBe(false);
    expect(result.attachedTo).toEqual([
      expect.objectContaining({ resourceId: "res_pg1", via: "claim" }),
    ]);
  });

  test("legacy volume name claims map to the same database", () => {
    const legacy: VolumeClaim = { ...pgClaim, volumeName: "old-pg-volume" };
    const result = mapVolume("old-pg-volume", index({ claims: [pgClaim, legacy] }));
    expect(result.attachedTo).toEqual([
      expect.objectContaining({ resourceId: "res_pg1", via: "claim" }),
    ]);
  });

  test("service_mount volume claim resolves to the service", () => {
    const result = mapVolume("web-uploads", index());
    expect(result.attachedTo).toEqual([
      expect.objectContaining({
        resourceId: "res_svc1",
        resourceType: "service",
        via: "claim",
      }),
    ]);
  });

  test("stack-prefixed volume is claimed by the compose resource", () => {
    const result = mapVolume("helio-monitoring_prometheus-data", index());
    expect(result.orphan).toBe(false);
    expect(result.attachedTo).toEqual([
      expect.objectContaining({ resourceId: "res_stack1", resourceType: "compose", via: "claim" }),
    ]);
  });

  test("stack prefix requires the underscore separator (no false positive on a sibling name)", () => {
    // "helio-monitoring-extra" is NOT a stack volume of "helio-monitoring".
    const result = mapVolume("helio-monitoring-extra", index());
    expect(result.attachedTo).toHaveLength(0);
    expect(result.orphan).toBe(true);
  });
});

describe("mapVolume — orphan detection", () => {
  test("unreferenced and unclaimed volume is an orphan", () => {
    const result = mapVolume("random-leftover", index());
    expect(result.refCount).toBe(0);
    expect(result.attachedTo).toHaveLength(0);
    expect(result.orphan).toBe(true);
  });

  test("mounted-by-anonymous-container volume is in use, not an orphan", () => {
    const idx = index({
      containers: [container({ name: "adhoc", volumeNames: ["scratch"] })],
    });
    const result = mapVolume("scratch", idx);
    expect(result.refCount).toBe(1);
    expect(result.orphan).toBe(false);
    expect(result.attachedTo).toHaveLength(0);
  });

  test("multiple containers mounting the same volume are all counted", () => {
    const idx = index({
      containers: [
        container({
          name: "web.1",
          labels: { "otterdeploy.resource.id": "res_svc1" },
          volumeNames: ["web-uploads"],
        }),
        container({
          name: "web.2",
          labels: { "otterdeploy.resource.id": "res_svc1" },
          volumeNames: ["web-uploads"],
        }),
      ],
    });
    const result = mapVolume("web-uploads", idx);
    expect(result.refCount).toBe(2);
    expect(result.containerNames).toEqual(["web.1", "web.2"]);
    // Same resource twice → one attachment.
    expect(result.attachedTo).toHaveLength(1);
  });
});
