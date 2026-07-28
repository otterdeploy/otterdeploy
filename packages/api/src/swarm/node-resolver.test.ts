import type { Node } from "@otterdeploy/docker";

import { describe, expect, test } from "vite-plus/test";

import { pickNodeForServer } from "./node-resolver";

const node = (id: string, hostname: string, state = "ready", availability = "active"): Node =>
  ({
    ID: id,
    Description: { Hostname: hostname },
    Status: { State: state },
    Spec: { Availability: availability },
  }) as Node;

describe("pickNodeForServer", () => {
  test("resolves the obvious single match", () => {
    const nodes = [node("aaa11", "web-1"), node("bbb22", "web-2")];
    expect(pickNodeForServer(nodes, { hostname: "web-2", name: "Web Two" })).toEqual({
      kind: "resolved",
      nodeId: "bbb22",
    });
  });

  test("picks the Ready node when a hostname is duplicated", () => {
    // The real shape of this cluster: a re-provisioned machine leaves its old
    // node registered, Down, under the same hostname. Listed FIRST here on
    // purpose — first-match would pin to the dead one.
    const nodes = [node("dead1", "ubuntu-4gb-nbg1-1", "down"), node("live1", "ubuntu-4gb-nbg1-1")];
    expect(pickNodeForServer(nodes, { hostname: "ubuntu-4gb-nbg1-1", name: null })).toEqual({
      kind: "resolved",
      nodeId: "live1",
    });
  });

  test("refuses to pin when every match is down", () => {
    const nodes = [node("dead1", "web-1", "down"), node("dead2", "web-1", "down")];
    const result = pickNodeForServer(nodes, { hostname: "web-1", name: null });
    expect(result.kind).toBe("unschedulable");
    // Swarm would accept a constraint naming a dead node and leave the task
    // pending forever, so this has to fail loudly instead.
    if (result.kind === "unschedulable") expect(result.reason).toContain("none schedulable");
  });

  test("treats a drained node as unschedulable even though it is ready", () => {
    const nodes = [node("drain1", "web-1", "ready", "drain")];
    expect(pickNodeForServer(nodes, { hostname: "web-1", name: null }).kind).toBe("unschedulable");
  });

  test("prefers a ready+active node over a ready+drained one", () => {
    const nodes = [node("drain1", "web-1", "ready", "drain"), node("live1", "web-1")];
    expect(pickNodeForServer(nodes, { hostname: "web-1", name: null })).toEqual({
      kind: "resolved",
      nodeId: "live1",
    });
  });

  test("reports unknown when no node carries the hostname", () => {
    const result = pickNodeForServer([node("aaa11", "web-1")], {
      hostname: "web-9",
      name: null,
    });
    expect(result.kind).toBe("unknown");
  });

  test("falls back to the friendly name for the bootstrap row", () => {
    // The bootstrap server row is named "localhost" with a null hostname.
    const nodes = [node("boot1", "localhost")];
    expect(pickNodeForServer(nodes, { hostname: null, name: "localhost" })).toEqual({
      kind: "resolved",
      nodeId: "boot1",
    });
  });

  test("hostname wins over name when both match different nodes", () => {
    const nodes = [node("byname", "prod-box"), node("byhost", "ip-10-0-0-4")];
    expect(pickNodeForServer(nodes, { hostname: "ip-10-0-0-4", name: "prod-box" })).toEqual({
      kind: "resolved",
      nodeId: "byhost",
    });
  });

  test("a down hostname match still yields to a live name match", () => {
    // Hostname is preferred, but only among nodes that can actually run work.
    const nodes = [node("byhost", "ip-10-0-0-4", "down"), node("byname", "prod-box")];
    expect(pickNodeForServer(nodes, { hostname: "ip-10-0-0-4", name: "prod-box" })).toEqual({
      kind: "resolved",
      nodeId: "byname",
    });
  });

  test("an unnamed row resolves to nothing rather than guessing", () => {
    expect(pickNodeForServer([node("aaa11", "web-1")], { hostname: null, name: null }).kind).toBe(
      "unknown",
    );
  });
});
