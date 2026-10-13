import { describe, expect, test } from "bun:test";

import { type Action, failoverDelayMs, plan } from "../plan";
import { T0, grant, node, service, silent, snapshot, spec } from "./fixtures";

const kinds = (actions: Action[]) => actions.map((a) => a.kind);
const pendingCodes = (actions: Action[]) =>
  actions.flatMap((a) => (a.kind === "pending" ? [a.reason.code] : []));
const issued = (actions: Action[]) => actions.filter((a) => a.kind === "issue");

const exclusiveSpec = spec("svc-db", {
  lifecycle: { exclusive: true, failoverPolicy: "reschedule", failoverDelayMs: 30_000 },
});
const sharedSpec = spec("svc-web", {
  lifecycle: { failoverPolicy: "reschedule", failoverDelayMs: 30_000 },
});

describe("failover", () => {
  const down = (ago: number, over = {}) => silent("n1", T0, ago, over);

  test("nothing moves before the node is down and the policy delay has passed", () => {
    const g = grant("svc-web", "n1");
    for (const [ago, code] of [
      [10_000, "node-suspect"],
      [31_000, "failover-delay"],
      [59_000, "failover-delay"],
    ] as const) {
      const svc = service(
        spec("svc-web", { lifecycle: { failoverPolicy: "reschedule", failoverDelayMs: 60_000 } }),
      );
      const a = plan(snapshot({ nodes: [down(ago), node("n2")], services: [svc], grants: [g] }));
      expect(issued(a)).toEqual([]);
      expect(pendingCodes(a)).toEqual([code]);
    }
  });

  test("a delay below the minimum is raised to 30 s, measured from the last evidence", () => {
    const s = spec("svc-web", { lifecycle: { failoverPolicy: "reschedule" } });
    const short = {
      ...s,
      lifecycle: { ...s.lifecycle, failover: { policy: "reschedule" as const, delayMs: 5_000 } },
    };
    expect(failoverDelayMs(short)).toBe(30_000);
    expect(failoverDelayMs(spec("x"))).toBe(60_000);
    const g = grant("svc-web", "n1");
    const at = (ago: number) =>
      plan(snapshot({ nodes: [down(ago), node("n2")], services: [service(short)], grants: [g] }));
    expect(pendingCodes(at(29_999))).toEqual(["node-suspect"]);
    expect(issued(at(30_000))).toHaveLength(1);
  });

  test("a shared copy is marked orphan-possible and replaced after the delay, without stop proof", () => {
    const g = grant("svc-web", "n1");
    const a = plan(
      snapshot({ nodes: [down(31_000), node("n2")], services: [service(sharedSpec)], grants: [g] }),
    );
    expect(kinds(a)).toEqual(["revoke", "orphan", "issue"]);
    expect(issued(a)[0]).toMatchObject({ nodeId: "n2", surge: false });
  });

  test("fresh peer evidence defers a shared move", () => {
    const g = grant("svc-web", "n1");
    const n1 = down(31_000, { peerFreshUntil: T0 + 5_000 });
    const a = plan(
      snapshot({ nodes: [n1, node("n2")], services: [service(sharedSpec)], grants: [g] }),
    );
    expect(pendingCodes(a)).toEqual(["partitioned"]);
  });

  test("an exclusive copy is revoked and waits; silence is never a stop", () => {
    const g = grant("svc-db", "n1", { exclusive: true });
    for (const ago of [31_000, 3_600_000]) {
      const a = plan(
        snapshot({
          nodes: [down(ago), node("n2")],
          services: [service(exclusiveSpec)],
          grants: [g],
        }),
      );
      expect(issued(a)).toEqual([]);
      expect(pendingCodes(a)).toEqual(["fence-required"]);
    }
  });

  test("with a fence enabled the exclusive copy is fenced, and moves only on the evidence", () => {
    const g = grant("svc-db", "n1", { exclusive: true });
    const fenceable = { fence: { adapter: "hetzner" as const, enabled: true } };
    const a = plan(
      snapshot({
        nodes: [down(31_000, fenceable), node("n2")],
        services: [service(exclusiveSpec)],
        grants: [g],
      }),
    );
    expect(kinds(a)).toEqual(["revoke", "fence", "pending"]);
    const fencing = { ...fenceable, fencing: true };
    const waiting = plan(
      snapshot({
        nodes: [down(40_000, fencing), node("n2")],
        services: [service(exclusiveSpec)],
        grants: [{ ...g, revoked: true, state: "unknown" }],
      }),
    );
    expect(pendingCodes(waiting)).toEqual(["fencing"]);
    const done = plan(
      snapshot({
        nodes: [down(50_000, fencing), node("n2")],
        services: [service(exclusiveSpec)],
        grants: [{ ...g, revoked: true, state: "unknown" }],
        retirements: [{ grantId: g.grantId, evidenceId: "fence-1", kind: "provider-power-off" }],
      }),
    );
    expect(kinds(done)).toEqual(["release", "issue"]);
    expect(issued(done)[0]).toMatchObject({ nodeId: "n2", exclusive: true });
  });

  test("stay never moves, even long after the node went down", () => {
    const s = spec("svc-db", { lifecycle: { exclusive: true, failoverPolicy: "stay" } });
    const g = grant("svc-db", "n1", { exclusive: true });
    const a = plan(
      snapshot({
        nodes: [down(3_600_000), node("n2")],
        services: [service(s, { homeNode: "n1" })],
        grants: [g],
      }),
    );
    expect(pendingCodes(a)).toEqual(["node-down"]);
    const released = plan(
      snapshot({
        nodes: [down(3_600_000), node("n2")],
        services: [service(s, { homeNode: "n1" })],
      }),
    );
    expect(issued(released)).toEqual([]);
  });

  test("a global service never replaces a missing node on another node", () => {
    const s = spec("agent", {
      global: true,
      lifecycle: { failoverPolicy: "reschedule", failoverDelayMs: 30_000 },
    });
    const g = grant("agent", "n1", { slotIndex: 1 });
    const a = plan(
      snapshot({
        nodes: [down(600_000), node("n2")],
        services: [service(s)],
        grants: [g, grant("agent", "n2", { slotIndex: 2 })],
      }),
    );
    expect(issued(a)).toEqual([]);
    expect(pendingCodes(a)).toEqual(["node-down"]);
  });

  test("a rejoined node stops its superseded copy before the reservation is released", () => {
    const orphan = grant("svc-web", "n1", { orphan: true, revoked: true });
    const repl = grant("svc-web", "n2", { generation: 2 });
    const a = plan(
      snapshot({
        nodes: [node("n1"), node("n2")],
        services: [service(sharedSpec)],
        grants: [orphan, repl],
      }),
    );
    expect(a).toEqual([
      { kind: "stop", grantId: orphan.grantId, reason: "superseded copy on a rejoined node" },
    ]);
  });
});

describe("node restart (boot quarantine)", () => {
  test("grants of an earlier incarnation are stopped for their certificate, then re-issued", () => {
    const g = grant("svc-db", "n1", { exclusive: true });
    const restarted = node("n1", { incarnation: "inc-n1-2" });
    const svc = service(
      spec("svc-db", { lifecycle: { exclusive: true, failoverPolicy: "stay" } }),
      { homeNode: "n1" },
    );
    const a = plan(snapshot({ nodes: [restarted], services: [svc], grants: [g] }));
    expect(kinds(a)).toEqual(["stop", "pending"]);
    const after = plan(
      snapshot({
        nodes: [restarted],
        services: [svc],
        grants: [{ ...g, stopRequested: true, revoked: true }],
        retirements: [{ grantId: g.grantId, evidenceId: "cert-1", kind: "stop-certificate" }],
      }),
    );
    expect(kinds(after)).toEqual(["release", "issue"]);
    expect(issued(after)[0]).toMatchObject({ nodeId: "n1" });
  });

  test("a shared copy of an earlier incarnation keeps running and is re-bound start-first on its node", () => {
    const g = grant("svc-web", "n1");
    const restarted = node("n1", { incarnation: "inc-n1-2", admin: "cordoned" });
    const a = plan(
      snapshot({ nodes: [restarted, node("n2")], services: [service(sharedSpec)], grants: [g] }),
    );
    expect(a).toEqual([
      expect.objectContaining({
        kind: "issue",
        nodeId: "n1",
        surge: true,
        reason: "re-bind after a node restart",
      }),
    ]);
    const fresh = grant("svc-web", "n1", {
      surge: true,
      generation: 2,
      incarnation: "inc-n1-2",
      runningSince: T0 - 1_000,
    });
    const waiting = plan(
      snapshot({
        nodes: [restarted, node("n2")],
        services: [service(sharedSpec)],
        grants: [g, fresh],
      }),
    );
    expect(pendingCodes(waiting)).toEqual(["rollout-waiting"]);
    const up = { ...fresh, runningSince: T0 - 60_000 };
    const done = plan(
      snapshot({
        nodes: [restarted, node("n2")],
        services: [service(sharedSpec)],
        grants: [g, up],
      }),
    );
    expect(done).toEqual([
      { kind: "stop", grantId: g.grantId, reason: "re-bound after a node restart" },
    ]);
  });
});

describe("rollout", () => {
  const rev2 = (s: ReturnType<typeof spec>, over = {}) =>
    service(s, { revision: 2, stableRevision: 1, ...over });

  test("exclusive is stop-first: stop, certificate, release, then the new generation", () => {
    const g = grant("svc-db", "n1", { exclusive: true });
    const a = plan(
      snapshot({ nodes: [node("n1"), node("n2")], services: [rev2(exclusiveSpec)], grants: [g] }),
    );
    expect(a).toEqual([
      { kind: "stop", grantId: g.grantId, reason: "update to revision 2 (stop-first)" },
    ]);
  });

  test("start-first issues a surge, waits the monitor period, then stops the incumbent", () => {
    const s = spec("svc-web", { replicas: 1, update: { order: "start-first", monitorMs: 10_000 } });
    const inc = grant("svc-web", "n1");
    const a = plan(
      snapshot({ nodes: [node("n1"), node("n2")], services: [rev2(s)], grants: [inc] }),
    );
    expect(issued(a)[0]).toMatchObject({ surge: true, specRevision: 2 });
    const surge = grant("svc-web", "n2", {
      surge: true,
      specRevision: 2,
      generation: 2,
      runningSince: T0 - 5_000,
    });
    const waiting = plan(
      snapshot({ nodes: [node("n1"), node("n2")], services: [rev2(s)], grants: [inc, surge] }),
    );
    expect(pendingCodes(waiting)).toEqual(["rollout-waiting"]);
    const ready = { ...surge, runningSince: T0 - 10_000 };
    const done = plan(
      snapshot({ nodes: [node("n1"), node("n2")], services: [rev2(s)], grants: [inc, ready] }),
    );
    expect(done[0]).toMatchObject({ kind: "stop", grantId: inc.grantId });
  });

  test("a host port forces stop-first even when start-first is asked", () => {
    const s = spec("svc-web", { hostPort: 8080 });
    const forced = { ...s, update: { ...s.update, order: "start-first" as const } };
    const inc = grant("svc-web", "n1");
    const a = plan(snapshot({ nodes: [node("n1")], services: [rev2(forced)], grants: [inc] }));
    expect(kinds(a)).toEqual(["stop"]);
  });

  test("parallelism bounds how many slots change at once", () => {
    const s = spec("svc-web", { replicas: 3, update: { parallelism: 1, order: "stop-first" } });
    const gs = [0, 1, 2].map((i) => grant("svc-web", `n${i + 1}`, { slotIndex: i }));
    const a = plan(
      snapshot({ nodes: [node("n1"), node("n2"), node("n3")], services: [rev2(s)], grants: gs }),
    );
    expect(kinds(a).filter((k) => k === "stop")).toHaveLength(1);
    expect(pendingCodes(a)).toEqual(["rollout-waiting", "rollout-waiting"]);
  });

  test("a failure ratio over the limit pauses the rollout", () => {
    const s = spec("svc-web", {
      replicas: 2,
      update: { parallelism: 2, maxFailureRatioPermille: 0, failureAction: "pause" },
    });
    const fresh = grant("svc-web", "n1", { specRevision: 2, failed: true, generation: 2 });
    const a = plan(
      snapshot({
        nodes: [node("n1"), node("n2")],
        services: [rev2(s)],
        grants: [fresh, grant("svc-web", "n2", { slotIndex: 1 })],
      }),
    );
    expect(a.filter((x) => x.kind === "rollout")).toEqual([
      { kind: "rollout", resourceId: "svc-web", outcome: "paused", revision: 2 },
    ]);
  });

  test("completion is reported once every slot runs the revision for the monitor period", () => {
    const s = spec("svc-web", { replicas: 1, update: { monitorMs: 5_000 } });
    const g = grant("svc-web", "n1", { specRevision: 2 });
    const a = plan(snapshot({ nodes: [node("n1")], services: [rev2(s)], grants: [g] }));
    expect(a).toEqual([
      { kind: "rollout", resourceId: "svc-web", outcome: "completed", revision: 2 },
    ]);
  });
});

describe("drain and rolling otterd upgrade", () => {
  test("one node at a time: drain exclusive work, upgrade, rejoin on a new incarnation, done", () => {
    const n1 = node("n1", { upgrade: { phase: "queued", fromIncarnation: null, since: T0 } });
    const n2 = node("n2", { upgrade: { phase: "queued", fromIncarnation: null, since: T0 } });
    expect(plan(snapshot({ nodes: [n1, n2] }))).toEqual([
      { kind: "upgrade-phase", nodeId: "n1", phase: "draining" },
    ]);

    const draining = {
      ...n1,
      admin: "cordoned" as const,
      upgrade: { phase: "draining" as const, fromIncarnation: "inc-n1-1", since: T0 },
    };
    const db = grant("svc-db", "n1", { exclusive: true });
    const web = grant("svc-web", "n1");
    const services = [service(exclusiveSpec), service(sharedSpec)];
    const moving = plan(snapshot({ nodes: [draining, n2], services, grants: [db, web] }));
    expect(moving).toEqual([
      { kind: "stop", grantId: db.grantId, reason: "drain n1: stop-first move" },
    ]);

    const sharedOnly = plan(
      snapshot({ nodes: [draining, n2], services: [service(sharedSpec)], grants: [web] }),
    );
    expect(sharedOnly).toEqual([{ kind: "upgrade-phase", nodeId: "n1", phase: "upgrading" }]);

    const upgrading = {
      ...draining,
      upgrade: { phase: "upgrading" as const, fromIncarnation: "inc-n1-1", since: T0 },
    };
    expect(plan(snapshot({ nodes: [upgrading, n2] }))).toEqual([]);
    const back = { ...upgrading, incarnation: "inc-n1-2" };
    expect(plan(snapshot({ nodes: [back, n2] }))).toEqual([
      { kind: "upgrade-phase", nodeId: "n1", phase: "rejoining" },
    ]);
    const rejoined = {
      ...back,
      upgrade: { phase: "rejoining" as const, fromIncarnation: "inc-n1-1", since: T0 },
    };
    const rebound = plan(
      snapshot({ nodes: [rejoined, n2], services: [service(sharedSpec)], grants: [web] }),
    );
    expect(rebound).toEqual([
      expect.objectContaining({ kind: "issue", nodeId: "n1", surge: true }),
      { kind: "upgrade-phase", nodeId: "n1", phase: "done" },
    ]);
    const finished = {
      ...rejoined,
      admin: "active" as const,
      upgrade: { phase: "done" as const, fromIncarnation: "inc-n1-1", since: T0 },
    };
    expect(plan(snapshot({ nodes: [finished, n2] }))).toEqual([
      { kind: "upgrade-phase", nodeId: "n2", phase: "draining" },
    ]);
  });

  test("a pinned exclusive service stops for the upgrade and comes back on its node after", () => {
    const s = spec("svc-db", { lifecycle: { exclusive: true, failoverPolicy: "stay" } });
    const svc = service(s, { homeNode: "n1" });
    const g = grant("svc-db", "n1", { exclusive: true });
    const draining = node("n1", {
      admin: "cordoned",
      upgrade: { phase: "draining", fromIncarnation: "inc-n1-1", since: T0 },
    });
    const a = plan(snapshot({ nodes: [draining, node("n2")], services: [svc], grants: [g] }));
    expect(a[0]).toMatchObject({ kind: "stop", grantId: g.grantId });
    const stopped = plan(snapshot({ nodes: [draining, node("n2")], services: [svc] }));
    expect(pendingCodes(stopped)).toEqual(["node-draining"]);
    const back = node("n1", { incarnation: "inc-n1-2" });
    expect(issued(plan(snapshot({ nodes: [back, node("n2")], services: [svc] })))[0]).toMatchObject(
      { nodeId: "n1" },
    );
  });

  test("a movable exclusive service moves stop-first off a draining node", () => {
    const g = grant("svc-db", "n1", { exclusive: true });
    const draining = node("n1", { admin: "draining" });
    const a = plan(
      snapshot({ nodes: [draining, node("n2")], services: [service(exclusiveSpec)], grants: [g] }),
    );
    expect(kinds(a)).toEqual(["stop"]);
    const released = plan(
      snapshot({ nodes: [draining, node("n2")], services: [service(exclusiveSpec)] }),
    );
    expect(issued(released)[0]).toMatchObject({ nodeId: "n2" });
  });
});
