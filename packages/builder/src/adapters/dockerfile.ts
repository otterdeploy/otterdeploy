import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { getImageName, getImageTag, tagAsLatest } from "../tagging";
import { runCommand } from "../spawn";
import type { BuildInput, BuildOutput, Builder } from "../types";

const log = createLogger("builder:dockerfile");

const DEFAULT_TIMEOUT = 600_000; // 10 minutes

export class DockerfileBuilder implements Builder {
  async build(input: BuildInput): Promise<Result<BuildOutput, Error>> {
    const start = Date.now();
    const imageName = getImageName(input.resourceId);
    const imageTag = getImageTag(input.deploymentNumber);
    const fullTag = `${imageName}:${imageTag}`;
    const logs: string[] = [];

    try {
      const dockerfilePath = input.dockerfilePath ?? "Dockerfile";

      const args = [
        "docker", "build",
        "-f", dockerfilePath,
        "-t", fullTag,
      ];

      // Build args
      if (input.buildArgs) {
        for (const [key, value] of Object.entries(input.buildArgs)) {
          args.push("--build-arg", `${key}=${value}`);
        }
      }

      // No-cache on force rebuild
      if (input.force) {
        args.push("--no-cache");
      }

      // Context directory
      args.push(input.sourceDir);

      log.info({ command: args[0], args: args.slice(1) }, "Starting Docker build");

      const timeout = input.timeout ?? DEFAULT_TIMEOUT;
      const result = await runCommand(args, { timeout });

      if (result.stdout) logs.push(...result.stdout.split("\n").filter(Boolean));
      if (result.stderr) logs.push(...result.stderr.split("\n").filter(Boolean));

      if (result.exitCode !== 0) {
        const errMsg = `Docker build failed with exit code ${result.exitCode}`;
        log.error({ exitCode: result.exitCode, logs }, errMsg);
        return Result.err(new Error(errMsg));
      }

      // Tag as latest
      const tagResult = await tagAsLatest(input.resourceId, input.deploymentNumber);
      if (tagResult.isErr()) {
        log.warn({ err: tagResult.error }, "Failed to tag as latest, continuing");
      }

      const durationMs = Date.now() - start;
      log.info({ imageName, imageTag, durationMs }, "Docker build completed");

      return Result.ok({
        imageName,
        imageTag,
        durationMs,
        logs,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error({ err }, "Docker build failed");
      return Result.err(err);
    }
  }
}
