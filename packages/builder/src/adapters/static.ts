import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { getImageName, getImageTag, tagAsLatest } from "../tagging";
import { runCommand } from "../spawn";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildInput, BuildOutput, Builder } from "../types";

const log = createLogger("builder:static");

const DEFAULT_TIMEOUT = 600_000; // 10 minutes

const STATIC_DOCKERFILE = `FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY . /srv
`;

function generateCaddyfile(spaMode: boolean): string {
  if (spaMode) {
    return `{
  auto_https off
}

:80 {
  root * /srv
  try_files {path} /index.html
  file_server
}
`;
  }

  return `{
  auto_https off
}

:80 {
  root * /srv
  file_server
}
`;
}

export class StaticBuilder implements Builder {
  async build(input: BuildInput): Promise<Result<BuildOutput, Error>> {
    const start = Date.now();
    const imageName = getImageName(input.resourceId);
    const imageTag = getImageTag(input.deploymentNumber);
    const fullTag = `${imageName}:${imageTag}`;
    const logs: string[] = [];

    try {
      // Determine SPA mode from buildArgs (default: SPA)
      const spaMode = input.buildArgs?.SPA_MODE !== "false";

      // Write Dockerfile
      const dockerfilePath = join(input.sourceDir, "Dockerfile");
      await writeFile(dockerfilePath, STATIC_DOCKERFILE, "utf-8");
      logs.push("Generated Dockerfile for static serving");

      // Write Caddyfile
      const caddyfilePath = join(input.sourceDir, "Caddyfile");
      await writeFile(caddyfilePath, generateCaddyfile(spaMode), "utf-8");
      logs.push(`Generated Caddyfile (SPA mode: ${spaMode})`);

      // Build with docker
      const args = [
        "docker", "build",
        "-f", dockerfilePath,
        "-t", fullTag,
      ];

      if (input.force) {
        args.push("--no-cache");
      }

      args.push(input.sourceDir);

      log.info({ command: args[0], args: args.slice(1), spaMode }, "Starting static site build");

      const timeout = input.timeout ?? DEFAULT_TIMEOUT;
      const result = await runCommand(args, { timeout });

      if (result.stdout) logs.push(...result.stdout.split("\n").filter(Boolean));
      if (result.stderr) logs.push(...result.stderr.split("\n").filter(Boolean));

      if (result.exitCode !== 0) {
        const errMsg = `Static site build failed with exit code ${result.exitCode}`;
        log.error({ exitCode: result.exitCode, logs }, errMsg);
        return Result.err(new Error(errMsg));
      }

      // Tag as latest
      const tagResult = await tagAsLatest(input.resourceId, input.deploymentNumber);
      if (tagResult.isErr()) {
        log.warn({ err: tagResult.error }, "Failed to tag as latest, continuing");
      }

      const durationMs = Date.now() - start;
      log.info({ imageName, imageTag, durationMs }, "Static site build completed");

      return Result.ok({
        imageName,
        imageTag,
        durationMs,
        logs,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error({ err }, "Static site build failed");
      return Result.err(err);
    }
  }
}
