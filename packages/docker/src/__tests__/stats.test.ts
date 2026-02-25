import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  listContainers,
  getContainerStats,
  execInContainer,
  lightCleanup,
  aggressiveCleanup,
  getDiskUsage,
} from "../stats";

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn().mockReturnValue({
      stats: vi.fn().mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          system_cpu_usage: 10000,
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 9000,
        },
        memory_stats: {
          usage: 256 * 1024 * 1024,
          limit: 1024 * 1024 * 1024,
        },
        networks: {
          eth0: { rx_bytes: 1024, tx_bytes: 512 },
        },
        blkio_stats: {
          io_service_bytes_recursive: [
            { op: "read", value: 4096 },
            { op: "write", value: 2048 },
          ],
        },
      }),
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on: vi.fn((event: string, cb: (...args: any[]) => void) => {
            if (event === "data") cb(Buffer.from("hello\n"));
            if (event === "end") cb();
          }),
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      }),
    }),
    pruneImages: vi.fn().mockResolvedValue({ SpaceReclaimed: 5000 }),
    pruneContainers: vi
      .fn()
      .mockResolvedValue({ ContainersDeleted: ["c1", "c2"] }),
    pruneVolumes: vi
      .fn()
      .mockResolvedValue({ VolumesDeleted: ["v1"] }),
    pruneBuilder: vi.fn().mockResolvedValue({ SpaceReclaimed: 2000 }),
    df: vi.fn().mockResolvedValue({
      Images: [{ Size: 100 * 1024 * 1024 }],
      Containers: [{ SizeRw: 50 * 1024 * 1024 }],
      Volumes: [{ UsageData: { Size: 200 * 1024 * 1024 } }],
      BuildCache: [{ Size: 30 * 1024 * 1024 }],
    }),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("listContainers", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("lists containers for a service", async () => {
    const mock = createMockDocker({
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c-abc",
          Names: ["/my-container"],
          Image: "nginx:latest",
          State: "running",
          Status: "Up 2 hours",
        },
      ]),
    });
    setDockerClient(mock);

    const result = await listContainers("my-service");

    expect(result.isOk()).toBe(true);
    const containers = result.unwrap();
    expect(containers).toHaveLength(1);
    expect(containers[0].id).toBe("c-abc");
    expect(containers[0].name).toBe("my-container");
    expect((mock.listContainers as any)).toHaveBeenCalledWith({
      all: false,
      filters: {
        label: ["com.docker.swarm.service.name=my-service"],
      },
    });
  });

  it("returns error when listing fails", async () => {
    const mock = createMockDocker({
      listContainers: vi
        .fn()
        .mockRejectedValue(new Error("list failed")),
    });
    setDockerClient(mock);

    const result = await listContainers();

    expect(result.isErr()).toBe(true);
  });
});

describe("getContainerStats", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("returns CPU, memory, network, and disk stats", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await getContainerStats("c-abc");

    expect(result.isOk()).toBe(true);
    const stats = result.unwrap();
    expect(stats.cpuPercent).toBeGreaterThan(0);
    expect(stats.memoryUsageMb).toBe(256);
    expect(stats.memoryLimitMb).toBe(1024);
    expect(stats.networkRxBytes).toBe(1024);
    expect(stats.networkTxBytes).toBe(512);
    expect(stats.blockReadBytes).toBe(4096);
    expect(stats.blockWriteBytes).toBe(2048);
  });
});

describe("execInContainer", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("executes a command and returns output", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await execInContainer("c-abc", ["echo", "hello"]);

    expect(result.isOk()).toBe(true);
    const execResult = result.unwrap();
    expect(execResult.exitCode).toBe(0);
    expect(execResult.output).toContain("hello");
  });
});

describe("lightCleanup", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("prunes dangling images and stopped containers", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await lightCleanup();

    expect(result.isOk()).toBe(true);
    const cleanup = result.unwrap();
    expect(cleanup.imagesReclaimed).toBe(5000);
    expect(cleanup.containersRemoved).toBe(2);
    expect(mock.pruneImages).toHaveBeenCalledWith({
      filters: { dangling: ["true"] },
    });
  });
});

describe("aggressiveCleanup", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("prunes images, volumes, and build cache", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await aggressiveCleanup();

    expect(result.isOk()).toBe(true);
    const cleanup = result.unwrap();
    expect(cleanup.imagesReclaimed).toBe(5000);
    expect(cleanup.volumesRemoved).toBe(1);
    expect(cleanup.buildCacheReclaimed).toBe(2000);
  });
});

describe("getDiskUsage", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("returns disk usage stats for all categories", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await getDiskUsage();

    expect(result.isOk()).toBe(true);
    const usage = result.unwrap();
    expect(usage.images.totalCount).toBe(1);
    expect(usage.images.totalSizeMb).toBe(100);
    expect(usage.containers.totalCount).toBe(1);
    expect(usage.containers.totalSizeMb).toBe(50);
    expect(usage.volumes.totalCount).toBe(1);
    expect(usage.volumes.totalSizeMb).toBe(200);
    expect(usage.buildCache.totalSizeMb).toBe(30);
  });
});
