/**
 * Host introspection — what the server the user deployed on actually looks
 * like right now: memory (+swap), disk at the data root, and Docker's disk
 * footprint (images/containers/volumes/build cache) with how much of it is
 * reclaimable. Feeds the Instance page "Server health" card, the monitor's
 * threshold alerts, and the reclaim recommendations.
 *
 * Everything is best-effort per section: a Docker hiccup nulls the docker
 * block instead of failing the whole read (honest-about-system-state: the UI
 * shows "unavailable", never fake zeros).
 */
import { Docker } from "@otterdeploy/docker";
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { existsSync } from "node:fs";
import { readFile, statfs } from "node:fs/promises";
import { freemem, totalmem } from "node:os";

import { getBranchPoolHealth, type BranchPoolHealth } from "./branch-pool";
// Type-only in the other direction, so this is not a runtime cycle.
import { deriveRecommendations } from "./recommendations";

export interface HostMemory {
  totalBytes: number;
  /** MemAvailable when /proc/meminfo exists (containers see the host's), else
   *  os.freemem() — the number that predicts whether a build will OOM. */
  availableBytes: number;
  usedPct: number;
  /** Null when the platform exposes no swap counters (e.g. macOS dev). */
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
}

export interface HostDisk {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPct: number;
}

export interface DockerUsageSection {
  count: number;
  activeCount: number;
  totalBytes: number;
  reclaimableBytes: number;
}

export interface DockerUsage {
  images: DockerUsageSection;
  containers: DockerUsageSection;
  volumes: DockerUsageSection;
  buildCache: DockerUsageSection;
}

export type ReclaimTarget = "images" | "build-cache" | "containers" | "branch-pool";

export interface HealthRecommendation {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  /** A one-click fix the UI can offer, when one exists. */
  action: ReclaimTarget | null;
}

export interface HostHealth {
  memory: HostMemory;
  disk: HostDisk | null;
  docker: DockerUsage | null;
  /** ZFS database-branching pool, when this install provisioned one. */
  branchPool: BranchPoolHealth | null;
  recommendations: HealthRecommendation[];
  sampledAt: string;
}

/** Parse a `Key:  12345 kB` line out of /proc/meminfo, in bytes. */
function meminfoBytes(text: string, key: string): number | null {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m"));
  return match?.[1] ? Number(match[1]) * 1024 : null;
}

async function readMemory(): Promise<HostMemory> {
  const total = totalmem();
  const proc = await Result.tryPromise({
    try: () => readFile("/proc/meminfo", "utf8"),
    catch: () => null,
  });
  const text = proc.isOk() ? proc.value : null;
  const available = (text ? meminfoBytes(text, "MemAvailable") : null) ?? freemem();
  return {
    totalBytes: total,
    availableBytes: available,
    usedPct: total > 0 ? Math.round(((total - available) / total) * 100) : 0,
    swapTotalBytes: text ? meminfoBytes(text, "SwapTotal") : null,
    swapFreeBytes: text ? meminfoBytes(text, "SwapFree") : null,
  };
}

async function readDisk(): Promise<HostDisk | null> {
  // Raw process.env (like BRANCH_ZFS_POOL) so the health agent — which runs
  // this module with no validated env — can point disk sampling at a
  // bind-mounted host path. Unset ⇒ data root, or "/" where that's absent
  // (agent containers: overlay-root statfs still reflects the host disk).
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see comment above)
  const override = process.env.HOST_HEALTH_DISK_PATH;
  const path = override && existsSync(override) ? override : existsSync(DATA_ROOT) ? DATA_ROOT : "/";
  const stat = await Result.tryPromise({ try: () => statfs(path), catch: () => null });
  if (stat.isErr()) return null;
  const total = stat.value.blocks * stat.value.bsize;
  const free = stat.value.bavail * stat.value.bsize;
  if (total <= 0) return null;
  return {
    path,
    totalBytes: total,
    freeBytes: free,
    usedPct: Math.round(((total - free) / total) * 100),
  };
}

interface BuildCacheItem {
  Size?: number;
  InUse?: boolean;
}

async function readDockerUsage(): Promise<DockerUsage | null> {
  const docker = Docker.fromEnv();
  try {
    const df = await docker.system.df();
    if (df.isErr()) return null;
    const { Images, Containers, Volumes, BuildCache } = df.value;

    const unusedImages = Images.filter((i) => i.Containers === 0);
    const images: DockerUsageSection = {
      count: Images.length,
      activeCount: Images.length - unusedImages.length,
      totalBytes: df.value.LayersSize,
      // Approximation of `docker system df` reclaimable: an unused image's
      // own layers (Size minus what it shares with other images).
      reclaimableBytes: unusedImages.reduce(
        (sum, i) => sum + Math.max(0, i.Size - i.SharedSize),
        0,
      ),
    };

    const running = Containers.filter((c) => c.State === "running");
    const containers: DockerUsageSection = {
      count: Containers.length,
      activeCount: running.length,
      totalBytes: Containers.reduce((sum, c) => sum + (c.SizeRw ?? 0), 0),
      reclaimableBytes: Containers.filter((c) => c.State !== "running").reduce(
        (sum, c) => sum + (c.SizeRw ?? 0),
        0,
      ),
    };

    const volumes: DockerUsageSection = {
      count: Volumes.length,
      activeCount: Volumes.filter((v) => (v.UsageData?.RefCount ?? 0) > 0).length,
      totalBytes: Volumes.reduce((sum, v) => sum + (v.UsageData?.Size ?? 0), 0),
      reclaimableBytes: Volumes.filter((v) => (v.UsageData?.RefCount ?? 0) === 0).reduce(
        (sum, v) => sum + (v.UsageData?.Size ?? 0),
        0,
      ),
    };

    const cacheItems = (BuildCache ?? []) as BuildCacheItem[];
    const idleCache = cacheItems.filter((c) => !c.InUse);
    const buildCache: DockerUsageSection = {
      count: cacheItems.length,
      activeCount: cacheItems.length - idleCache.length,
      totalBytes: cacheItems.reduce((sum, c) => sum + (c.Size ?? 0), 0),
      reclaimableBytes: idleCache.reduce((sum, c) => sum + (c.Size ?? 0), 0),
    };

    return { images, containers, volumes, buildCache };
  } finally {
    docker.destroy();
  }
}

export async function getHostHealth(): Promise<HostHealth> {
  const [memory, disk, dockerUsage, branchPool] = await Promise.all([
    readMemory(),
    readDisk(),
    Result.tryPromise({ try: () => readDockerUsage(), catch: () => null }).then((r) =>
      r.isOk() ? r.value : null,
    ),
    Result.tryPromise({ try: () => getBranchPoolHealth(), catch: () => null }).then((r) =>
      r.isOk() ? r.value : null,
    ),
  ]);
  return {
    memory,
    disk,
    docker: dockerUsage,
    branchPool,
    recommendations: deriveRecommendations(memory, disk, dockerUsage, branchPool),
    sampledAt: new Date().toISOString(),
  };
}
