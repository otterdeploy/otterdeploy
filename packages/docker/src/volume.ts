import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type { VolumeInfo } from "./types";

const log = createLogger("docker:volume");

export async function createVolume(
  name: string,
  labels?: Record<string, string>,
): Promise<Result<VolumeInfo, Error>> {
  const docker = getDockerClient();

  try {
    const volume = await docker.createVolume({
      Name: name,
      Labels: {
        "otterstack.managed": "true",
        ...(labels ?? {}),
      },
    });

    const info = await volume.inspect();

    log.info({ name }, "Volume created");
    return Result.ok({
      name: info.Name,
      driver: info.Driver,
      mountpoint: info.Mountpoint,
      labels: info.Labels ?? {},
      createdAt: info.CreatedAt ?? "",
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to create volume");
    return Result.err(err);
  }
}

export async function removeVolume(
  name: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const volume = docker.getVolume(name);

    // Safety check: inspect to see if volume exists
    await volume.inspect();
    await volume.remove();

    log.info({ name }, "Volume removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to remove volume");
    return Result.err(err);
  }
}

export async function inspectVolume(
  name: string,
): Promise<Result<VolumeInfo, Error>> {
  const docker = getDockerClient();

  try {
    const volume = docker.getVolume(name);
    const info = await volume.inspect();

    return Result.ok({
      name: info.Name,
      driver: info.Driver,
      mountpoint: info.Mountpoint,
      labels: info.Labels ?? {},
      createdAt: info.CreatedAt ?? "",
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to inspect volume");
    return Result.err(err);
  }
}

export async function listVolumes(
  filters?: Record<string, string[]>,
): Promise<Result<VolumeInfo[], Error>> {
  const docker = getDockerClient();

  try {
    const opts: Record<string, unknown> = {};
    if (filters) {
      opts.filters = filters;
    }

    const response = await docker.listVolumes(opts);
    const volumes = response.Volumes ?? [];

    const result: VolumeInfo[] = volumes.map((v: any) => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      labels: v.Labels ?? {},
      createdAt: v.CreatedAt ?? "",
    }));

    return Result.ok(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to list volumes");
    return Result.err(err);
  }
}
