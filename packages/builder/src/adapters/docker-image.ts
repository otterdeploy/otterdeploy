import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { pullImage, tagImage } from "@otterdeploy/docker";
import { getImageName, getImageTag } from "../tagging";
import type { BuildInput, BuildOutput, Builder } from "../types";

const log = createLogger("builder:docker-image");

export class DockerImageBuilder implements Builder {
  async build(input: BuildInput): Promise<Result<BuildOutput, Error>> {
    const start = Date.now();
    const localImageName = getImageName(input.resourceId);
    const localImageTag = getImageTag(input.deploymentNumber);
    const logs: string[] = [];

    try {
      const emitLog = (line: string, stream: "stdout" | "stderr" = "stdout") => {
        logs.push(line);
        try {
          void input.onLogLine?.(line, stream);
        } catch {
          // Ignore callback failures to keep builds resilient.
        }
      };

      // The sourceDir for docker_image method contains the image reference (e.g. "nginx:1.25")
      const remoteImage = input.sourceDir;

      log.info({ remoteImage }, "Pulling remote image");
      emitLog(`Pulling image: ${remoteImage}`);

      const pullResult = await pullImage(remoteImage);
      if (pullResult.isErr()) {
        return Result.err(pullResult.error);
      }

      emitLog(`Image pulled successfully: ${pullResult.unwrap()}`);

      // Tag as local otterstack image
      const localVersioned = `${localImageName}:${localImageTag}`;
      const tagVersionResult = await tagImage(remoteImage, localVersioned);
      if (tagVersionResult.isErr()) {
        return Result.err(tagVersionResult.error);
      }
      emitLog(`Tagged as: ${localVersioned}`);

      // Tag as latest
      const localLatest = `${localImageName}:latest`;
      const tagLatestResult = await tagImage(remoteImage, localLatest);
      if (tagLatestResult.isErr()) {
        log.warn({ err: tagLatestResult.error }, "Failed to tag as latest, continuing");
      } else {
        emitLog(`Tagged as: ${localLatest}`);
      }

      const durationMs = Date.now() - start;
      log.info({ localImageName, localImageTag, durationMs }, "Docker image pull completed");

      return Result.ok({
        imageName: localImageName,
        imageTag: localImageTag,
        durationMs,
        logs,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error({ err }, "Docker image pull failed");
      return Result.err(err);
    }
  }
}
