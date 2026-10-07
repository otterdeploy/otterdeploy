/**
 * The project events stream's background work cannot take the
 * process down, and a lost Redis subscription ends the stream with the
 * router's typed error instead of leaving it idle without build events.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const deps = vi.hoisted(() => {
  const state: { listCalls: number; failRefresh: boolean; onBusFailure: (() => void) | null } = {
    listCalls: 0,
    failRefresh: false,
    onBusFailure: null,
  };
  return state;
});

vi.mock("../queries", () => ({
  getProjectInOrg: async () => ({ slug: "demo" }),
}));
vi.mock("../queries/resource", () => ({
  listProjectResources: async () => {
    deps.listCalls += 1;
    if (deps.failRefresh && deps.listCalls > 1) throw new Error("connection refused");
    return { databases: [], services: [] };
  },
}));
vi.mock("../../../swarm", () => ({
  subscribeDockerEvents: () => ({ close: () => {} }),
}));
vi.mock("../project-event-bus", () => ({
  subscribeProjectEvents: (_projectId: string, _onEvent: unknown, onFailure: () => void) => {
    deps.onBusFailure = onFailure;
    return { close: () => {} };
  },
}));

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { streamProjectEvents } from "../events-stream";

const input = {
  projectId: zId(ID_PREFIX.project).parse("prj_eventstreamtest00000000000"),
  organizationId: zId(ID_PREFIX.organization).parse("org_eventstreamtest00000000000"),
};

afterEach(() => {
  vi.useRealTimers();
  deps.listCalls = 0;
  deps.failRefresh = false;
  deps.onBusFailure = null;
});

describe("streamProjectEvents", () => {
  it("ends with the router's typed error when the Redis subscription fails", async () => {
    const unavailable = new Error("LIVE_UPDATES_UNAVAILABLE");
    const stream = streamProjectEvents(input, { createUnavailableError: () => unavailable });
    const next = stream.next();
    await vi.waitFor(() => expect(deps.onBusFailure).not.toBeNull());
    deps.onBusFailure?.();
    await expect(next).rejects.toBe(unavailable);
  });

  it("a failed service-map refresh keeps the stream open instead of rejecting unhandled", async () => {
    vi.useFakeTimers();
    deps.failRefresh = true;
    const controller = new AbortController();
    const stream = streamProjectEvents(input, { signal: controller.signal });
    const next = stream.next();
    await vi.waitFor(() => expect(deps.onBusFailure).not.toBeNull());
    // The refresh fires and fails; an unhandled rejection here fails the run.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.listCalls).toBe(2);
    controller.abort();
    await expect(next).resolves.toEqual({ done: true, value: undefined });
  });
});
