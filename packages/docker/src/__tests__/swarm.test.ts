import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import { initSwarm, isSwarmActive, createIngressNetwork } from "../swarm";

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    swarmInspect: vi.fn(),
    swarmInit: vi.fn(),
    listNetworks: vi.fn().mockResolvedValue([]),
    createNetwork: vi.fn().mockResolvedValue({ id: "net-123" }),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("isSwarmActive", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("returns true when Swarm is active", async () => {
    const mock = createMockDocker({
      swarmInspect: vi.fn().mockResolvedValue({ ID: "swarm-abc" }),
    });
    setDockerClient(mock);

    const result = await isSwarmActive();
    expect(result).toBe(true);
  });

  it("returns false when Swarm is not active", async () => {
    const mock = createMockDocker({
      swarmInspect: vi
        .fn()
        .mockRejectedValue(new Error("This node is not a swarm manager")),
    });
    setDockerClient(mock);

    const result = await isSwarmActive();
    expect(result).toBe(false);
  });
});

describe("initSwarm", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("initializes Swarm when inactive, binding to localhost", async () => {
    const mock = createMockDocker({
      swarmInspect: vi
        .fn()
        .mockRejectedValue(new Error("This node is not a swarm manager")),
      swarmInit: vi.fn().mockResolvedValue("node-id-123"),
    });
    setDockerClient(mock);

    const result = await initSwarm();

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.nodeId).toBe("node-id-123");
    expect(value.alreadyActive).toBe(false);
    expect(mock.swarmInit).toHaveBeenCalledWith({
      ListenAddr: "127.0.0.1:2377",
    });
  });

  it("skips init when Swarm is already active", async () => {
    const mock = createMockDocker({
      swarmInspect: vi.fn().mockResolvedValue({ ID: "existing-swarm-id" }),
      swarmInit: vi.fn(),
    });
    setDockerClient(mock);

    const result = await initSwarm();

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.nodeId).toBe("existing-swarm-id");
    expect(value.alreadyActive).toBe(true);
    expect(mock.swarmInit).not.toHaveBeenCalled();
  });

  it("returns error when swarmInit fails", async () => {
    const mock = createMockDocker({
      swarmInspect: vi
        .fn()
        .mockRejectedValue(new Error("This node is not a swarm manager")),
      swarmInit: vi
        .fn()
        .mockRejectedValue(new Error("swarm init failed")),
    });
    setDockerClient(mock);

    const result = await initSwarm();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("swarm init failed");
    }
  });
});

describe("createIngressNetwork", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("creates overlay network with correct config when not exists", async () => {
    const mock = createMockDocker({
      listNetworks: vi.fn().mockResolvedValue([]),
      createNetwork: vi.fn().mockResolvedValue({ id: "net-new-456" }),
    });
    setDockerClient(mock);

    const result = await createIngressNetwork();

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.networkId).toBe("net-new-456");
    expect(value.alreadyExists).toBe(false);
    expect(mock.createNetwork).toHaveBeenCalledWith({
      Name: "otterstack-ingress",
      Driver: "overlay",
      Attachable: true,
      Labels: {
        "otterstack.managed": "true",
        "otterstack.network.role": "ingress",
      },
    });
  });

  it("skips creation when network already exists", async () => {
    const mock = createMockDocker({
      listNetworks: vi.fn().mockResolvedValue([
        { Name: "otterstack-ingress", Id: "net-existing-789" },
      ]),
      createNetwork: vi.fn(),
    });
    setDockerClient(mock);

    const result = await createIngressNetwork();

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.networkId).toBe("net-existing-789");
    expect(value.alreadyExists).toBe(true);
    expect(mock.createNetwork).not.toHaveBeenCalled();
  });

  it("returns error when network creation fails", async () => {
    const mock = createMockDocker({
      listNetworks: vi.fn().mockResolvedValue([]),
      createNetwork: vi
        .fn()
        .mockRejectedValue(new Error("network create failed")),
    });
    setDockerClient(mock);

    const result = await createIngressNetwork();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("network create failed");
    }
  });
});
