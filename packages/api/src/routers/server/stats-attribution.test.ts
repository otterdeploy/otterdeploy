import type { Node, Task } from "@otterdeploy/docker";

import { describe, expect, test } from "vite-plus/test";

import { isLiveTask, localHostRowIndex, unreachableNodeIds } from "./stats-attribution";

const node = (id: string, state: string) => ({ ID: id, Status: { State: state } }) as Node;
const task = (nodeId: string | undefined, state: string) =>
  ({ NodeID: nodeId, Status: { State: state } }) as Task;

describe("unreachableNodeIds", () => {
  test("collects every node that isn't ready", () => {
    const set = unreachableNodeIds([node("a", "ready"), node("b", "down"), node("c", "unknown")]);
    expect([...set].sort()).toEqual(["b", "c"]);
  });

  test("state comparison is case-insensitive", () => {
    expect(unreachableNodeIds([node("a", "Ready")]).size).toBe(0);
  });
});

describe("isLiveTask", () => {
  const none = new Set<string>();

  test("a running task on a reachable node counts", () => {
    expect(isLiveTask(task("a", "running"), none)).toBe(true);
  });

  test("a non-running task never counts", () => {
    expect(isLiveTask(task("a", "shutdown"), none)).toBe(false);
    expect(isLiveTask(task("a", "failed"), none)).toBe(false);
  });

  test("a 'running' task on an unreachable node does NOT count", () => {
    // The stale-state case: the manager stopped hearing from the node, so this
    // status is its last observation, not current fact.
    expect(isLiveTask(task("gone", "running"), new Set(["gone"]))).toBe(false);
  });

  test("an unscheduled task (no NodeID) is judged on its state alone", () => {
    expect(isLiveTask(task(undefined, "running"), new Set(["gone"]))).toBe(true);
  });
});

describe("localHostRowIndex", () => {
  test("picks the manager row on 127.0.0.1, not merely the first row", () => {
    // The reported bug: a worker sorted first and was credited with every
    // container the control-plane host was actually running.
    const rows = [
      { name: "build", host: "178.104.96.212", role: "worker" },
      { name: "localhost", host: "127.0.0.1", role: "manager" },
    ];
    expect(localHostRowIndex(rows)).toBe(1);
  });

  test("matches the bootstrap row by name too", () => {
    expect(
      localHostRowIndex([
        { name: "worker-2", host: "10.0.0.9", role: "worker" },
        { name: "localhost", host: "10.0.0.1", role: "manager" },
      ]),
    ).toBe(1);
  });

  test("a manager that isn't the local host is not chosen", () => {
    expect(localHostRowIndex([{ name: "remote-mgr", host: "10.0.0.5", role: "manager" }])).toBe(0);
  });

  test("falls back to the first row rather than dropping the count", () => {
    expect(localHostRowIndex([{ name: "only", host: "10.0.0.2", role: "worker" }])).toBe(0);
    expect(localHostRowIndex([])).toBe(0);
  });
});
