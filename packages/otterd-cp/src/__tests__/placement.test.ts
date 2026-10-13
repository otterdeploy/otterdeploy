import { describe, expect, test } from "bun:test";

import { admit, mayRelease } from "../admission";
import { place, usageByNode } from "../placement";
import { GIB, T0, grant, node, silent, spec } from "./fixtures";

describe("placement", () => {
  test("filters by readiness, role, architecture, constraints and capacity, and says why", () => {
    const s = spec("svc", {
      placement: {
        architectures: ["amd64"],
        constraints: [{ key: "node.labels.zone", op: "eq", value: "a" }],
      },
      memoryBytes: 2 * GIB,
    });
    const nodes = [
      node("n1", { labels: { zone: "a" } }),
      node("n2", { labels: { zone: "b" } }),
      node("n3", { labels: { zone: "a" }, arch: "aarch64" }),
      node("n4", { labels: { zone: "a" }, roles: ["edge"] }),
      silent("n5", T0, 20_000, { labels: { zone: "a" } }),
      node("n6", { labels: { zone: "a" }, admin: "cordoned" }),
      node("n7", { labels: { zone: "a" }, allocatable: { nanoCpus: 1e9, memoryBytes: GIB } }),
    ];
    const r = place({ spec: s, nodes, grants: [], usage: new Map(), now: T0 });
    expect(r.unwrap()).toBe("n1");
    const none = place({ spec: s, nodes: nodes.slice(1), grants: [], usage: new Map(), now: T0 });
    expect(none.isErr() && none.error.refused).toEqual({
      n2: "constraint",
      n3: "architecture",
      n4: "role",
      n5: "not-ready",
      n6: "not-active",
      n7: "memory",
    });
  });

  test("spreads replicas, then prefers free memory, then the lower node id", () => {
    const s = spec("svc", { replicas: 3 });
    const nodes = [
      node("n2"),
      node("n1"),
      node("n3", { allocatable: { nanoCpus: 4e9, memoryBytes: 8 * GIB } }),
    ];
    const g = [grant("svc", "n3")];
    const usage = usageByNode(g, () => s);
    expect(place({ spec: s, nodes, grants: g, usage, now: T0 }).unwrap()).toBe("n1");
    expect(place({ spec: s, nodes, grants: [], usage: new Map(), now: T0 }).unwrap()).toBe("n3");
  });

  test("orphan-possible copies keep their reservation on the node", () => {
    const s = spec("svc", { memoryBytes: 3 * GIB });
    const orphan = grant("svc", "n1", { orphan: true });
    const usage = usageByNode([orphan], () => s);
    const r = place({ spec: s, nodes: [node("n1")], grants: [orphan], usage, now: T0 });
    expect(r.isErr() && r.error.refused).toEqual({ n1: "memory" });
  });
});

describe("admission and release", () => {
  test("an exclusive slot admits nothing while any grant is not released (I1), and generations climb (I2)", () => {
    for (const state of ["prepared", "granted", "running", "stopping", "unknown"] as const) {
      const held = grant("db", "n1", { exclusive: true, state });
      const r = admit({ highWater: 4, grants: [held] }, { exclusive: true, surge: false });
      expect(r.isErr() && r.error.code).toBe("exclusive-slot-held");
    }
    expect(admit({ highWater: 4, grants: [] }, { exclusive: true, surge: false }).unwrap()).toBe(5);
  });

  test("a shared slot admits one active grant and one surge; an orphan does not occupy it", () => {
    const inc = grant("web", "n1");
    expect(admit({ highWater: 1, grants: [inc] }, { exclusive: false, surge: true }).unwrap()).toBe(
      2,
    );
    expect(admit({ highWater: 1, grants: [inc] }, { exclusive: false, surge: false }).isErr()).toBe(
      true,
    );
    const orphan = { ...inc, orphan: true };
    expect(
      admit({ highWater: 1, grants: [orphan] }, { exclusive: false, surge: false }).unwrap(),
    ).toBe(2);
  });

  test("only a never-sent Prepared grant releases without evidence", () => {
    expect(mayRelease(grant("db", "n1", { state: "prepared", sentAt: null }), null).unwrap()).toBe(
      "cancel",
    );
    for (const state of ["granted", "running", "stopping", "unknown"] as const) {
      expect(mayRelease(grant("db", "n1", { state }), null).isErr()).toBe(true);
    }
    const g = grant("db", "n1", { state: "unknown" });
    const r = { grantId: g.grantId, evidenceId: "ev1", kind: "provider-power-off" as const };
    expect(mayRelease(g, r).unwrap()).toBe("evidence");
    expect(mayRelease(g, { ...r, grantId: "other" }).isErr()).toBe(true);
  });
});
