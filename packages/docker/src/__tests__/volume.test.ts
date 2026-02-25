import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  createVolume,
  removeVolume,
  inspectVolume,
  listVolumes,
} from "../volume";

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    createVolume: vi.fn().mockResolvedValue({
      inspect: vi.fn().mockResolvedValue({
        Name: "otterstack-res1-data",
        Driver: "local",
        Mountpoint: "/var/lib/docker/volumes/otterstack-res1-data/_data",
        Labels: { "otterstack.managed": "true" },
        CreatedAt: "2026-01-01T00:00:00Z",
      }),
    }),
    getVolume: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Name: "otterstack-res1-data",
        Driver: "local",
        Mountpoint: "/var/lib/docker/volumes/otterstack-res1-data/_data",
        Labels: { "otterstack.managed": "true" },
        CreatedAt: "2026-01-01T00:00:00Z",
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    }),
    listVolumes: vi.fn().mockResolvedValue({
      Volumes: [
        {
          Name: "otterstack-res1-data",
          Driver: "local",
          Mountpoint: "/var/lib/docker/volumes/otterstack-res1-data/_data",
          Labels: { "otterstack.managed": "true" },
          CreatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    }),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("createVolume", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("creates a volume with labels", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await createVolume("otterstack-res1-data", {
      "otterstack.resource.id": "res1",
    });

    expect(result.isOk()).toBe(true);
    const vol = result.unwrap();
    expect(vol.name).toBe("otterstack-res1-data");
    expect(vol.driver).toBe("local");
    expect(mock.createVolume).toHaveBeenCalledWith({
      Name: "otterstack-res1-data",
      Labels: {
        "otterstack.managed": "true",
        "otterstack.resource.id": "res1",
      },
    });
  });

  it("returns error when creation fails", async () => {
    const mock = createMockDocker({
      createVolume: vi
        .fn()
        .mockRejectedValue(new Error("volume create failed")),
    });
    setDockerClient(mock);

    const result = await createVolume("test-vol");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("volume create failed");
    }
  });
});

describe("removeVolume", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("removes a volume after inspecting it", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getVolume: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({}),
        remove: mockRemove,
      }),
    });
    setDockerClient(mock);

    const result = await removeVolume("otterstack-res1-data");

    expect(result.isOk()).toBe(true);
    expect(mockRemove).toHaveBeenCalled();
  });

  it("returns error when volume not found", async () => {
    const mock = createMockDocker({
      getVolume: vi.fn().mockReturnValue({
        inspect: vi
          .fn()
          .mockRejectedValue(new Error("no such volume")),
        remove: vi.fn(),
      }),
    });
    setDockerClient(mock);

    const result = await removeVolume("nonexistent");

    expect(result.isErr()).toBe(true);
  });
});

describe("inspectVolume", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("returns volume info", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await inspectVolume("otterstack-res1-data");

    expect(result.isOk()).toBe(true);
    const vol = result.unwrap();
    expect(vol.name).toBe("otterstack-res1-data");
    expect(vol.mountpoint).toContain("otterstack-res1-data");
  });
});

describe("listVolumes", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("lists volumes with mapped info", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await listVolumes();

    expect(result.isOk()).toBe(true);
    const vols = result.unwrap();
    expect(vols).toHaveLength(1);
    expect(vols[0].name).toBe("otterstack-res1-data");
  });
});
