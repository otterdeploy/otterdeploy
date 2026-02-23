import { Result } from "better-result";
import { tagImage, listImages, removeImage } from "@otterdeploy/docker";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("builder:tagging");

export function getImageName(resourceId: string): string {
  return `otterstack-${resourceId}`;
}

export function getImageTag(deploymentNumber: number): string {
  return `v${deploymentNumber}`;
}

export async function tagAsLatest(
  resourceId: string,
  deploymentNumber: number,
): Promise<Result<void, Error>> {
  const imageName = getImageName(resourceId);
  const imageTag = getImageTag(deploymentNumber);
  const source = `${imageName}:${imageTag}`;
  const target = `${imageName}:latest`;

  log.info({ source, target }, "Tagging image as latest");
  return tagImage(source, target);
}

export async function pruneOldTags(
  resourceId: string,
  keep = 10,
): Promise<Result<string[], Error>> {
  const imageName = getImageName(resourceId);

  try {
    const imagesResult = await listImages({
      reference: [`${imageName}`],
    });

    if (imagesResult.isErr()) {
      return Result.err(imagesResult.error);
    }

    const images = imagesResult.unwrap();

    // Collect all versioned tags (v1, v2, ...) across all images
    const versionedTags: { tag: string; version: number }[] = [];
    for (const img of images) {
      for (const repoTag of img.repoTags) {
        const tag = repoTag.split(":")[1];
        if (tag && tag.startsWith("v")) {
          const version = parseInt(tag.slice(1), 10);
          if (!isNaN(version)) {
            versionedTags.push({ tag, version });
          }
        }
      }
    }

    // Sort descending by version number
    versionedTags.sort((a, b) => b.version - a.version);

    // Tags to remove are those beyond the `keep` count
    const toRemove = versionedTags.slice(keep);
    const removed: string[] = [];

    for (const { tag } of toRemove) {
      const fullTag = `${imageName}:${tag}`;
      const removeResult = await removeImage(imageName, tag);
      if (removeResult.isOk()) {
        removed.push(fullTag);
      } else {
        log.warn({ tag: fullTag, err: removeResult.error }, "Failed to remove old tag");
      }
    }

    log.info({ resourceId, removed: removed.length, kept: keep }, "Pruned old image tags");
    return Result.ok(removed);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, resourceId }, "Failed to prune old tags");
    return Result.err(err);
  }
}
