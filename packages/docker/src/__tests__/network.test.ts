import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  createProjectNetwork,
  removeProjectNetwork,
  connectServiceToNetwork,
  disconnectServiceFromNetwork,
} from "../network";

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    listNetworks: vi.fn().mockResolvedValue([]),
    createNetwork: vi.fn().mockResolvedValue({ id: "net-proj-123" }),
    getNetwork: vi.fn().mockReturnValue({
      remove: vi.fn().mockResolvedValue(undefined),
    }),
    listServices: vi.fn().mockResolvedValue([]),
    getService: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        ID: "svc-caddy",
        Spec: {
          Name: "otterstack-caddy",
          TaskTemplate: {
            ContainerSpec: { Image: "caddy:latest" },
            Networks: [],
          },
          Mode: { Replicated: { Replicas: 1 } },
          Labels: {},
        },
        Version: { Index: 3 },
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("createProjectNetwork", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("creates an overlay encrypted attachable network", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await createProjectNetwork("proj-abc");

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.networkId).toBe("net-proj-123");
    expect(value.alreadyExists).toBe(false);

    expect(mock.createNetwork).toHaveBeenCalledWith({
      Name: "otterstack-proj-proj-abc",
      Driver: "overlay",
      Attachable: true,
      Options: { encrypted: "true" },
      Labels: {
        "otterstack.managed": "true",
        "otterstack.project.id": "proj-abc",
        "otterstack.network.role": "project",
      },
    });
  });

  it("skips creation when network already exists", async () => {
    const mock = createMockDocker({
      listNetworks: vi.fn().mockResolvedValue([
        { Name: "otterstack-proj-proj-abc", Id: "net-existing-999" },
      ]),
    });
    setDockerClient(mock);

    const result = await createProjectNetwork("proj-abc");

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.networkId).toBe("net-existing-999");
    expect(value.alreadyExists).toBe(true);
    expect(mock.createNetwork).not.toHaveBeenCalled();
  });

  it("connects Caddy service when found by label", async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      listServices: vi.fn().mockResolvedValue([
        { ID: "svc-caddy-id", Spec: { Name: "otterstack-caddy" } },
      ]),
      getService: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          ID: "svc-caddy-id",
          Spec: {
            Name: "otterstack-caddy",
            TaskTemplate: {
              ContainerSpec: { Image: "caddy:latest" },
              Networks: [],
            },
            Mode: { Replicated: { Replicas: 1 } },
            Labels: {},
          },
          Version: { Index: 3 },
        }),
        update: mockUpdate,
      }),
    });
    setDockerClient(mock);

    const result = await createProjectNetwork("proj-xyz");

    expect(result.isOk()).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.TaskTemplate.Networks).toEqual(
      expect.arrayContaining([{ Target: "otterstack-proj-proj-xyz" }]),
    );
  });

  it("returns error when network creation fails", async () => {
    const mock = createMockDocker({
      createNetwork: vi
        .fn()
        .mockRejectedValue(new Error("network create failed")),
    });
    setDockerClient(mock);

    const result = await createProjectNetwork("proj-fail");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("network create failed");
    }
  });
});

describe("removeProjectNetwork", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("removes a project network", async () => {
    const mockNetworkRemove = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getNetwork: vi.fn().mockReturnValue({
        remove: mockNetworkRemove,
      }),
    });
    setDockerClient(mock);

    const result = await removeProjectNetwork("proj-abc");

    expect(result.isOk()).toBe(true);
    expect(mockNetworkRemove).toHaveBeenCalled();
  });
});

describe("connectServiceToNetwork", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("connects a service to a network", async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getService: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          ID: "svc-123",
          Spec: {
            Name: "my-service",
            TaskTemplate: {
              ContainerSpec: { Image: "nginx:latest" },
              Networks: [],
            },
            Mode: { Replicated: { Replicas: 1 } },
            Labels: {},
          },
          Version: { Index: 1 },
        }),
        update: mockUpdate,
      }),
    });
    setDockerClient(mock);

    const result = await connectServiceToNetwork(
      "my-service",
      "otterstack-proj-abc",
    );

    expect(result.isOk()).toBe(true);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.TaskTemplate.Networks).toEqual([
      { Target: "otterstack-proj-abc" },
    ]);
  });
});

describe("disconnectServiceFromNetwork", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("disconnects a service from a network", async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getService: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          ID: "svc-123",
          Spec: {
            Name: "my-service",
            TaskTemplate: {
              ContainerSpec: { Image: "nginx:latest" },
              Networks: [
                { Target: "otterstack-proj-abc" },
                { Target: "otterstack-ingress" },
              ],
            },
            Mode: { Replicated: { Replicas: 1 } },
            Labels: {},
          },
          Version: { Index: 2 },
        }),
        update: mockUpdate,
      }),
    });
    setDockerClient(mock);

    const result = await disconnectServiceFromNetwork(
      "my-service",
      "otterstack-proj-abc",
    );

    expect(result.isOk()).toBe(true);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.TaskTemplate.Networks).toEqual([
      { Target: "otterstack-ingress" },
    ]);
  });
});
