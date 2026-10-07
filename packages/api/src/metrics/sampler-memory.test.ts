/**
 * The memory figure the sampler stores is the working set, not raw
 * cgroup usage.
 *
 * Docker's `memory_stats.usage` includes the page cache. A container that has
 * read a large file shows that file as "used" until the kernel needs the pages
 * back, so a healthy service charts as near its limit and an operator chases a
 * leak that does not exist. The UI labels the figure "working set", and
 * `docker stats` computes it as usage minus inactive file pages:
 *
 *   cgroup v2: usage - memory_stats.stats.inactive_file
 *   cgroup v1: usage - memory_stats.stats.total_inactive_file
 *
 * Driven through the real `sampleAllContainers` pass with only the IO seams
 * replaced: the Docker client (which serves two recorded stats frames, the
 * second carrying the precpu delta the sampler reads) and the db insert (which
 * captures the rows instead of writing them).
 */
import { Result } from "better-result";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const inserted: unknown[] = [];
const statsFrames: string[] = [];

vi.mock("@otterdeploy/db", () => ({
  db: {
    insert: () => ({
      values: (rows: unknown[]) => {
        inserted.push(...rows);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@otterdeploy/docker", () => ({
  Docker: {
    fromEnv: () => ({
      containers: {
        list: () =>
          Promise.resolve(
            Result.ok([
              {
                Id: "c0ffee",
                Status: "Up 2 hours",
                Labels: {
                  "otterdeploy.managed": "true",
                  "otterdeploy.resource.id": "res_memory000000000000000",
                },
              },
            ]),
          ),
        getContainer: () => ({
          stats: () => Promise.resolve(Result.ok(Readable.from(statsFrames.map((f) => `${f}\n`)))),
        }),
      },
      destroy: () => undefined,
    }),
  },
}));

vi.mock("./health-detector", () => ({
  healthFromStatus: () => null,
  recordHealthObservations: () => Promise.resolve(),
}));
vi.mock("./platform", () => ({ samplePlatformMetrics: () => Promise.resolve() }));

const { sampleAllContainers } = await import("./sampler");

const MiB = 1024 * 1024;

/** A stats frame as dockerd emits it, trimmed to the fields that matter. */
function frame(memoryStats: Record<string, unknown>, cpuTotal: number, systemTotal: number) {
  return JSON.stringify({
    read: "2026-10-06T12:00:01.000000000Z",
    cpu_stats: {
      cpu_usage: { total_usage: cpuTotal },
      system_cpu_usage: systemTotal,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: { total_usage: cpuTotal - 1_000_000 },
      system_cpu_usage: systemTotal - 20_000_000,
    },
    memory_stats: memoryStats,
    networks: { eth0: { rx_bytes: 1200, tx_bytes: 3400 } },
  });
}

/** cgroup v2 host (current Docker default): flat `stats` keys. */
const CGROUP_V2_MEMORY = {
  usage: 512 * MiB,
  limit: 1024 * MiB,
  stats: {
    anon: 180 * MiB,
    file: 320 * MiB,
    active_file: 120 * MiB,
    inactive_file: 200 * MiB,
    kernel_stack: 1 * MiB,
  },
};

/** cgroup v1 host: `total_*` keys. */
const CGROUP_V1_MEMORY = {
  usage: 512 * MiB,
  max_usage: 600 * MiB,
  limit: 1024 * MiB,
  stats: {
    cache: 320 * MiB,
    rss: 180 * MiB,
    total_cache: 320 * MiB,
    total_rss: 180 * MiB,
    total_active_file: 120 * MiB,
    total_inactive_file: 200 * MiB,
  },
};

async function sampledMemBytes(memoryStats: Record<string, unknown>): Promise<unknown> {
  statsFrames.length = 0;
  statsFrames.push(
    frame(memoryStats, 50_000_000, 9_000_000_000),
    frame(memoryStats, 51_000_000, 9_020_000_000),
  );
  await sampleAllContainers();
  const [row] = inserted;
  expect(row).toMatchObject({ memLimitBytes: 1024 * MiB });
  return typeof row === "object" && row !== null && "memBytes" in row ? row.memBytes : undefined;
}

beforeEach(() => {
  inserted.length = 0;
});

describe("sampled memory is the working set", () => {
  it("on cgroup v2 memBytes is usage minus stats.inactive_file (docker stats working set)", async () => {
    expect(await sampledMemBytes(CGROUP_V2_MEMORY)).toBe(312 * MiB);
  });

  it("on cgroup v1 memBytes is usage minus stats.total_inactive_file (docker stats working set)", async () => {
    expect(await sampledMemBytes(CGROUP_V1_MEMORY)).toBe(312 * MiB);
  });

  // Control: with no breakdown there is nothing to subtract, so the
  // raw usage is the best figure available and must still be recorded.
  it("a frame with no memory breakdown falls back to raw usage", async () => {
    expect(await sampledMemBytes({ usage: 256 * MiB, limit: 1024 * MiB })).toBe(256 * MiB);
  });
});
