import type { Node } from "@otterdeploy/docker";

import { describe, expect, test } from "vite-plus/test";

import { buildRoleUpdate } from "../node-match";
import { assessDemotion, canRemoveFromSwarm, quorumRequired } from "../swarm-guards";

const node = (over: Partial<Node> = {}): Node => ({
  ID: "node-1",
  Version: { Index: 42 },
  Spec: { Role: "manager", Availability: "active" },
  Description: { Hostname: "prod-04" },
  Status: { State: "ready" },
  ...over,
});

describe("quorumRequired", () => {
  test("is the raft majority: floor(m/2)+1", () => {
    expect(quorumRequired(1)).toBe(1);
    // 2 managers need BOTH reachable — worse fault tolerance than 1.
    expect(quorumRequired(2)).toBe(2);
    expect(quorumRequired(3)).toBe(2);
    expect(quorumRequired(4)).toBe(3);
    expect(quorumRequired(5)).toBe(3);
    expect(quorumRequired(7)).toBe(4);
  });

  test("clamps degenerate inputs instead of going negative", () => {
    expect(quorumRequired(0)).toBe(1);
    expect(quorumRequired(-3)).toBe(1);
  });
});

describe("assessDemotion", () => {
  const manager = (id: string, leader = false): Node =>
    node({
      ID: id,
      Spec: { Role: "manager", Availability: "active" },
      ManagerStatus: { Leader: leader, Reachability: "reachable" },
    });
  const worker = (id: string): Node =>
    node({ ID: id, Spec: { Role: "worker", Availability: "active" }, ManagerStatus: null });

  test("refuses demoting the last manager", () => {
    const only = manager("m1", true);
    expect(assessDemotion([only, worker("w1"), worker("w2")], only)).toBe("last-manager");
  });

  test("last-manager wins over leader for a solo manager (clearest refusal)", () => {
    const only = manager("m1", true);
    expect(assessDemotion([only], only)).toBe("last-manager");
  });

  test("refuses demoting the leader when other managers exist", () => {
    const leader = manager("m1", true);
    const peer = manager("m2");
    expect(assessDemotion([leader, peer, worker("w1")], leader)).toBe("leader");
  });

  test("allows demoting a non-leader manager when quorum survives", () => {
    const leader = manager("m1", true);
    const peer = manager("m2");
    const third = manager("m3");
    expect(assessDemotion([leader, peer, third], peer)).toBeNull();
  });

  test("is a no-op for a node that is already a worker", () => {
    const w = worker("w1");
    expect(assessDemotion([manager("m1", true), w], w)).toBeNull();
  });
});

describe("canRemoveFromSwarm", () => {
  test("only nodes reported down may be removed", () => {
    expect(canRemoveFromSwarm(node({ Status: { State: "down" } }))).toBe(true);
  });

  test("refuses ready, draining-but-up, unknown, and missing states", () => {
    expect(canRemoveFromSwarm(node({ Status: { State: "ready" } }))).toBe(false);
    expect(canRemoveFromSwarm(node({ Status: { State: "disconnected" } }))).toBe(false);
    expect(canRemoveFromSwarm(node({ Status: { State: "unknown" } }))).toBe(false);
    expect(canRemoveFromSwarm(node({ Status: undefined }))).toBe(false);
  });
});

describe("buildRoleUpdate", () => {
  test("carries version + name/labels/availability and sets the role", () => {
    const n = node({
      Version: { Index: 7 },
      Spec: { Name: "prod-04", Labels: { zone: "a" }, Role: "worker", Availability: "drain" },
    });
    expect(buildRoleUpdate(n, "manager")).toEqual({
      version: 7,
      Name: "prod-04",
      Labels: { zone: "a" },
      Availability: "drain",
      Role: "manager",
    });
  });

  test("omits absent spec fields rather than sending undefined keys", () => {
    const n = node({ Version: { Index: 3 }, Spec: { Role: "manager" } });
    const update = buildRoleUpdate(n, "worker");
    expect(update).toEqual({ version: 3, Role: "worker" });
    expect(update).not.toHaveProperty("Name");
    expect(update).not.toHaveProperty("Labels");
    expect(update).not.toHaveProperty("Availability");
  });

  test("defaults version to 0 when the node has no version index", () => {
    const n = node({ Version: undefined, Spec: undefined });
    expect(buildRoleUpdate(n, "manager")).toEqual({ version: 0, Role: "manager" });
  });
});
