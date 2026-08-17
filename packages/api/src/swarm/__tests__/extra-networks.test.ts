import { describe, expect, test } from "vite-plus/test";

import type { SwarmServiceSpec } from "../service";

import { partitionExtraNetworks, resolveExtraNetworkTargets } from "../extra-networks";
import { buildServiceSpec } from "../internals";

const PROJECT_NET = "otterdeploy-myproject";

describe("resolveExtraNetworkTargets", () => {
  test("undefined / empty ⇒ no targets", () => {
    expect(resolveExtraNetworkTargets(undefined, PROJECT_NET)).toEqual([]);
    expect(resolveExtraNetworkTargets([], PROJECT_NET)).toEqual([]);
  });

  test("dedupes while preserving first-seen order", () => {
    expect(resolveExtraNetworkTargets(["mesh-a", "mesh-b", "mesh-a"], PROJECT_NET)).toEqual([
      "mesh-a",
      "mesh-b",
    ]);
  });

  test("drops the always-on project network (it is attached unconditionally)", () => {
    expect(resolveExtraNetworkTargets([PROJECT_NET, "mesh-a"], PROJECT_NET)).toEqual(["mesh-a"]);
  });

  test("drops empty names", () => {
    expect(resolveExtraNetworkTargets(["", "mesh-a"], PROJECT_NET)).toEqual(["mesh-a"]);
  });
});

describe("partitionExtraNetworks", () => {
  const existing = [
    { name: "mesh-overlay", driver: "overlay" },
    { name: "mesh-bridge", driver: "bridge" },
  ];

  test("existing network with the required driver ⇒ apply", () => {
    expect(partitionExtraNetworks(["mesh-overlay"], existing, "overlay")).toEqual({
      apply: ["mesh-overlay"],
      skipped: [],
    });
  });

  test("missing network ⇒ skipped with a not-found reason, never a throw", () => {
    const { apply, skipped } = partitionExtraNetworks(["ghost-net"], existing, "overlay");
    expect(apply).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toMatch(/not found/);
  });

  test("wrong driver ⇒ skipped, reason names both drivers", () => {
    const { apply, skipped } = partitionExtraNetworks(["mesh-bridge"], existing, "overlay");
    expect(apply).toEqual([]);
    expect(skipped[0]?.reason).toMatch(/bridge/);
    expect(skipped[0]?.reason).toMatch(/overlay/);
  });

  test("mixed request partitions independently", () => {
    const { apply, skipped } = partitionExtraNetworks(
      ["mesh-overlay", "ghost-net", "mesh-bridge"],
      existing,
      "overlay",
    );
    expect(apply).toEqual(["mesh-overlay"]);
    expect(skipped.map((s) => s.name)).toEqual(["ghost-net", "mesh-bridge"]);
  });
});

describe("buildServiceSpec network targets", () => {
  const spec: SwarmServiceSpec = {
    resourceId: "res_1",
    resourceName: "api",
    projectSlug: "myproject",
    serviceName: "myproject-api",
    internalHostname: "api.myproject.internal",
    image: "ghcr.io/acme/api:latest",
    env: {},
    replicas: 1,
    restart: { condition: "on-failure", delayMs: 5000 },
    ports: [],
    mounts: [],
    forceUpdateCounter: 0,
  };

  test("no extras ⇒ only the aliased project network", () => {
    const built = buildServiceSpec(spec, PROJECT_NET);
    expect(built.TaskTemplate.Networks).toEqual([
      {
        Target: PROJECT_NET,
        Aliases: ["myproject-api", "api.myproject.internal", "api"],
      },
    ]);
  });

  test("extras append alias-less, deduped, project network never doubled", () => {
    const built = buildServiceSpec(
      { ...spec, extraNetworks: ["mesh-a", PROJECT_NET, "mesh-a", "mesh-b"] },
      PROJECT_NET,
    );
    expect(built.TaskTemplate.Networks.map((n) => n.Target)).toEqual([
      PROJECT_NET,
      "mesh-a",
      "mesh-b",
    ]);
    // Only the project network carries discovery aliases.
    expect(built.TaskTemplate.Networks.slice(1).every((n) => n.Aliases.length === 0)).toBe(true);
  });
});
