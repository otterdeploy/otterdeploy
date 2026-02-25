import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type {
  ContainerInfo,
  ContainerStats,
  ExecResult,
  DiskUsageInfo,
} from "./types";

const log = createLogger("docker:stats");

export async function listContainers(
  serviceFilter?: string,
): Promise<Result<ContainerInfo[], Error>> {
  const docker = getDockerClient();

  try {
    const filters: Record<string, string[]> = {};
    if (serviceFilter) {
      filters.label = [`com.docker.swarm.service.name=${serviceFilter}`];
    }

    const containers = await docker.listContainers({
      all: false,
      filters,
    });

    const result: ContainerInfo[] = containers.map((c: any) => ({
      id: c.Id,
      name: (c.Names?.[0] ?? "").replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
    }));

    return Result.ok(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to list containers");
    return Result.err(err);
  }
}

function calculateCpuPercent(stats: any): number {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus ?? 1;

  if (systemDelta > 0 && cpuDelta >= 0) {
    return (cpuDelta / systemDelta) * numCpus * 100;
  }
  return 0;
}

function calculateNetworkStats(stats: any): {
  rx: number;
  tx: number;
} {
  let rx = 0;
  let tx = 0;

  if (stats.networks) {
    for (const iface of Object.values(stats.networks) as any[]) {
      rx += iface.rx_bytes ?? 0;
      tx += iface.tx_bytes ?? 0;
    }
  }

  return { rx, tx };
}

function calculateBlockIO(stats: any): {
  read: number;
  write: number;
} {
  let read = 0;
  let write = 0;

  const entries = stats.blkio_stats?.io_service_bytes_recursive ?? [];
  for (const entry of entries) {
    if (entry.op === "read" || entry.op === "Read") read += entry.value ?? 0;
    if (entry.op === "write" || entry.op === "Write") write += entry.value ?? 0;
  }

  return { read, write };
}

export async function getContainerStats(
  containerId: string,
): Promise<Result<ContainerStats, Error>> {
  const docker = getDockerClient();

  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    const memoryUsage = stats.memory_stats?.usage ?? 0;
    const memoryLimit = stats.memory_stats?.limit ?? 1;
    const network = calculateNetworkStats(stats);
    const blockIO = calculateBlockIO(stats);

    return Result.ok({
      cpuPercent: Math.round(calculateCpuPercent(stats) * 100) / 100,
      memoryUsageMb: Math.round(memoryUsage / (1024 * 1024)),
      memoryLimitMb: Math.round(memoryLimit / (1024 * 1024)),
      memoryPercent:
        Math.round((memoryUsage / memoryLimit) * 100 * 100) / 100,
      networkRxBytes: network.rx,
      networkTxBytes: network.tx,
      blockReadBytes: blockIO.read,
      blockWriteBytes: blockIO.write,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, containerId }, "Failed to get container stats");
    return Result.err(err);
  }
}

export async function execInContainer(
  containerId: string,
  cmd: string[],
): Promise<Result<ExecResult, Error>> {
  const docker = getDockerClient();

  try {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.on("error", reject);
    });

    const inspection = await exec.inspect();
    const exitCode = inspection.ExitCode ?? 0;

    return Result.ok({ exitCode, output });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, containerId }, "Failed to exec in container");
    return Result.err(err);
  }
}

export async function lightCleanup(): Promise<
  Result<{ imagesReclaimed: number; containersRemoved: number }, Error>
> {
  const docker = getDockerClient();

  try {
    const imageResult = await docker.pruneImages({
      filters: { dangling: ["true"] },
    });
    const containerResult = await docker.pruneContainers();

    const imagesReclaimed = imageResult.SpaceReclaimed ?? 0;
    const containersRemoved =
      (containerResult as any).ContainersDeleted?.length ?? 0;

    log.info(
      { imagesReclaimed, containersRemoved },
      "Light cleanup completed",
    );
    return Result.ok({ imagesReclaimed, containersRemoved });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to perform light cleanup");
    return Result.err(err);
  }
}

export async function aggressiveCleanup(): Promise<
  Result<
    {
      imagesReclaimed: number;
      volumesRemoved: number;
      buildCacheReclaimed: number;
    },
    Error
  >
> {
  const docker = getDockerClient();

  try {
    const imageResult = await docker.pruneImages({});
    const volumeResult = await docker.pruneVolumes();
    const buildResult = (await (docker as any).pruneBuilder?.()) ?? {
      SpaceReclaimed: 0,
    };

    const imagesReclaimed = imageResult.SpaceReclaimed ?? 0;
    const volumesRemoved =
      (volumeResult as any).VolumesDeleted?.length ?? 0;
    const buildCacheReclaimed = buildResult.SpaceReclaimed ?? 0;

    log.info(
      { imagesReclaimed, volumesRemoved, buildCacheReclaimed },
      "Aggressive cleanup completed",
    );
    return Result.ok({
      imagesReclaimed,
      volumesRemoved,
      buildCacheReclaimed,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to perform aggressive cleanup");
    return Result.err(err);
  }
}

export async function getDiskUsage(): Promise<
  Result<DiskUsageInfo, Error>
> {
  const docker = getDockerClient();

  try {
    const df = await docker.df();

    const toMb = (bytes: number) => Math.round(bytes / (1024 * 1024));

    const images = {
      totalCount: df.Images?.length ?? 0,
      totalSizeMb: toMb(
        (df.Images ?? []).reduce((sum: number, img: any) => sum + (img.Size ?? 0), 0),
      ),
    };

    const containers = {
      totalCount: df.Containers?.length ?? 0,
      totalSizeMb: toMb(
        (df.Containers ?? []).reduce(
          (sum: number, c: any) => sum + (c.SizeRw ?? 0),
          0,
        ),
      ),
    };

    const volumes = {
      totalCount: df.Volumes?.length ?? 0,
      totalSizeMb: toMb(
        (df.Volumes ?? []).reduce(
          (sum: number, v: any) => sum + (v.UsageData?.Size ?? 0),
          0,
        ),
      ),
    };

    const buildCache = {
      totalSizeMb: toMb(
        (df.BuildCache ?? []).reduce(
          (sum: number, bc: any) => sum + (bc.Size ?? 0),
          0,
        ),
      ),
    };

    return Result.ok({ images, containers, volumes, buildCache });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to get disk usage");
    return Result.err(err);
  }
}
