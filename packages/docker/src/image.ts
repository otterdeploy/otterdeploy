import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type { ImageInfo } from "./types";

const log = createLogger("docker:image");

export async function pullImage(
  image: string,
  tag?: string,
): Promise<Result<string, Error>> {
  const docker = getDockerClient();

  try {
    const fullImage = tag ? `${image}:${tag}` : image;

    const stream = await docker.pull(fullImage);

    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    log.info({ image: fullImage }, "Image pulled successfully");
    return Result.ok(fullImage);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, image }, "Failed to pull image");
    return Result.err(err);
  }
}

export async function tagImage(
  source: string,
  target: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const img = docker.getImage(source);
    const [repo, tag] = target.includes(":")
      ? [target.slice(0, target.lastIndexOf(":")), target.slice(target.lastIndexOf(":") + 1)]
      : [target, "latest"];

    await img.tag({ repo, tag });
    log.info({ source, target }, "Image tagged");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, source, target }, "Failed to tag image");
    return Result.err(err);
  }
}

export async function removeImage(
  name: string,
  tag?: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const fullName = tag ? `${name}:${tag}` : name;
    const img = docker.getImage(fullName);
    await img.remove();
    log.info({ image: fullName }, "Image removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to remove image");
    return Result.err(err);
  }
}

export async function pruneImages(
  dangling = true,
): Promise<Result<{ spaceReclaimed: number }, Error>> {
  const docker = getDockerClient();

  try {
    const filters: Record<string, string[]> = {};
    if (dangling) {
      filters.dangling = ["true"];
    }

    const result = await docker.pruneImages({ filters });
    const spaceReclaimed = result.SpaceReclaimed ?? 0;
    log.info({ spaceReclaimed, dangling }, "Images pruned");
    return Result.ok({ spaceReclaimed });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to prune images");
    return Result.err(err);
  }
}

export async function listImages(
  filters?: Record<string, string[]>,
): Promise<Result<ImageInfo[], Error>> {
  const docker = getDockerClient();

  try {
    const opts: Record<string, unknown> = {};
    if (filters) {
      opts.filters = filters;
    }

    const images = await docker.listImages(opts);

    const result: ImageInfo[] = images.map((img: any) => ({
      id: img.Id,
      repoTags: img.RepoTags ?? [],
      sizeMb: Math.round((img.Size ?? 0) / (1024 * 1024)),
      created: img.Created,
    }));

    return Result.ok(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to list images");
    return Result.err(err);
  }
}
