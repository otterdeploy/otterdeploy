import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { BuildResult, PipelineDeps, ResourceConfig } from "./types";

const log = createLogger("pipeline:build");

export interface BuildDeps {
  /**
   * Dispatch build to the appropriate builder (nixpacks, dockerfile, docker_image, static).
   */
  buildImage: (input: {
    builder?: string;
    sourceDir: string;
    resourceId: string;
    deploymentNumber: number;
    env: Record<string, string>;
    buildArgs?: Record<string, string>;
    buildCommand?: string;
    startCommand?: string;
    dockerfilePath?: string;
    force?: boolean;
    onLogLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
  }) => Promise<
    Result<{ imageName: string; imageTag: string; durationMs: number; logs: string[] }, Error>
  >;

  /**
   * Tag the built image as :latest for the resource.
   */
  tagAsLatest: (resourceId: string, deploymentNumber: number) => Promise<Result<void, Error>>;

  /**
   * Update the deployment record with the image tag.
   */
  updateDeployment: PipelineDeps["updateDeployment"];
}

/**
 * Step 4: Build image.
 * - Dispatches to the correct builder based on builder.
 * - Passes build-time env vars as build args.
 * - Tags the image as :latest.
 * - Records the image tag on the deployment.
 *
 * Idempotent: re-building with the same inputs produces the same image tag.
 * Docker layer cache handles duplicate work.
 */
export async function buildImage(
  input: {
    deploymentId: string;
    resourceId: string;
    builder: string;
    sourceDir: string;
    buildTimeEnv: Record<string, string>;
    resource: ResourceConfig;
    deploymentNumber: number;
    force?: boolean;
    existingImageTag?: string | null;
    onLogLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
  },
  deps: BuildDeps,
): Promise<Result<BuildResult, Error>> {
  try {
    const { deploymentId, resourceId, builder, sourceDir, resource } = input;

    // For rollbacks with an existing image tag, skip building
    if (input.existingImageTag && builder !== "docker_image") {
      const imageName = `otterstack-${resourceId}`;
      const fullImage = `${imageName}:${input.existingImageTag}`;

      log.info(
        { deploymentId, imageTag: input.existingImageTag },
        "Using existing image tag (rollback)",
      );
      if (input.onLogLine) {
        try {
          void input.onLogLine("Reusing existing image tag from rollback", "stdout");
        } catch {
          // Ignore callback failures to keep rollback flow resilient.
        }
      }

      return Result.ok({
        imageName,
        imageTag: input.existingImageTag,
        fullImage,
        durationMs: 0,
        logs: ["Reusing existing image tag from rollback"],
      });
    }

    // Build the image
    const buildResult = await deps.buildImage({
      builder,
      sourceDir,
      resourceId,
      deploymentNumber: input.deploymentNumber,
      env: input.buildTimeEnv,
      buildCommand: resource.buildCommand ?? undefined,
      startCommand: resource.startCommand ?? undefined,
      dockerfilePath: resource.dockerfilePath ?? undefined,
      force: input.force,
      onLogLine: input.onLogLine,
    });

    if (buildResult.isErr()) {
      return Result.err(buildResult.error);
    }

    const { imageName, imageTag, durationMs, logs: buildLogs } = buildResult.value;
    const fullImage = `${imageName}:${imageTag}`;

    // Tag as :latest
    const tagResult = await deps.tagAsLatest(resourceId, input.deploymentNumber);
    if (tagResult.isErr()) {
      log.warn({ err: tagResult.error, deploymentId }, "Failed to tag as latest (non-fatal)");
    }

    // Record image tag on the deployment
    await deps.updateDeployment(deploymentId, {
      imageTag,
      previousImageTag: input.existingImageTag ?? undefined,
    });

    log.info({ deploymentId, fullImage, durationMs }, "Image built and tagged");

    return Result.ok({
      imageName,
      imageTag,
      fullImage,
      durationMs,
      logs: buildLogs,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Build failed");
    return Result.err(err);
  }
}
