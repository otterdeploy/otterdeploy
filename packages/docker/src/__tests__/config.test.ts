import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  createDockerConfig,
  removeDockerConfig,
  listDockerConfigs,
} from "../config";

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    createConfig: vi.fn().mockResolvedValue({
      inspect: vi.fn().mockResolvedValue({
        ID: "cfg-abc-123",
        Spec: { Name: "my-config" },
        CreatedAt: "2026-01-01T00:00:00Z",
        UpdatedAt: "2026-01-01T00:00:00Z",
      }),
    }),
    listConfigs: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockReturnValue({
      remove: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("createDockerConfig", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("creates a config with base64-encoded data", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await createDockerConfig("my-config", "server { }");

    expect(result.isOk()).toBe(true);
    const config = result.unwrap();
    expect(config.id).toBe("cfg-abc-123");
    expect(config.name).toBe("my-config");

    const createCall = (mock as any).createConfig.mock.calls[0][0];
    expect(createCall.Name).toBe("my-config");
    expect(createCall.Data).toBe(Buffer.from("server { }").toString("base64"));
    expect(createCall.Labels["otterstack.managed"]).toBe("true");
  });

  it("returns error when creation fails", async () => {
    const mock = createMockDocker({
      createConfig: vi
        .fn()
        .mockRejectedValue(new Error("config create failed")),
    });
    setDockerClient(mock);

    const result = await createDockerConfig("bad-config", "data");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("config create failed");
    }
  });
});

describe("removeDockerConfig", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("removes a config by name", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      listConfigs: vi.fn().mockResolvedValue([
        { ID: "cfg-123", Spec: { Name: "my-config" } },
      ]),
      getConfig: vi.fn().mockReturnValue({ remove: mockRemove }),
    });
    setDockerClient(mock);

    const result = await removeDockerConfig("my-config");

    expect(result.isOk()).toBe(true);
    expect(mockRemove).toHaveBeenCalled();
  });

  it("returns error when config not found", async () => {
    const mock = createMockDocker({
      listConfigs: vi.fn().mockResolvedValue([]),
    });
    setDockerClient(mock);

    const result = await removeDockerConfig("nonexistent");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("not found");
    }
  });
});

describe("listDockerConfigs", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("lists configs and maps to DockerConfigInfo", async () => {
    const mock = createMockDocker({
      listConfigs: vi.fn().mockResolvedValue([
        {
          ID: "cfg-1",
          Spec: { Name: "config-a" },
          CreatedAt: "2026-01-01T00:00:00Z",
          UpdatedAt: "2026-01-02T00:00:00Z",
        },
        {
          ID: "cfg-2",
          Spec: { Name: "config-b" },
          CreatedAt: "2026-01-03T00:00:00Z",
          UpdatedAt: "2026-01-04T00:00:00Z",
        },
      ]),
    });
    setDockerClient(mock);

    const result = await listDockerConfigs();

    expect(result.isOk()).toBe(true);
    const configs = result.unwrap();
    expect(configs).toHaveLength(2);
    expect(configs[0].name).toBe("config-a");
    expect(configs[1].name).toBe("config-b");
  });
});
