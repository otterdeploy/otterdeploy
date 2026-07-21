/**
 * Build (and optionally push) a single `build:` service of a compose stack.
 *
 * Split out of `compose-build.ts` so the per-service step is self-contained:
 * it resolves the build method (Dockerfile vs Railpack) for the service's
 * context subdir, builds its own image (`<repo>-<service>:<sha>`), and pushes
 * to the bound registry when one exists. Returns the immutable `:<sha>` tag the
 * stack will reference. Mirrors the pipeline's single-service builder.
 */

import { decryptSecret } from "@otterdeploy/api/lib/crypto";
import { type ParsedBuild } from "@otterdeploy/api/stack/compose/types";
import { containerRegistry } from "@otterdeploy/db/schema";
import { Result } from "better-result";

import type { LogSink } from "./log-stream";

import { readFileSync } from "node:fs";

import { cachePathFor } from "./buildx";
import { dockerPush } from "./docker-push";
import { dockerfileBuild, resolveDockerfileBuild } from "./dockerfile";
import { assertDockerfileValid } from "./dockerfile-validate";
import { BuildStepError } from "./errors";
import { railpackBuild } from "./railpack";

/** Build one compose `build:` service to its own image and push it when the
 *  stack binds an external registry. Resolves to the `:<sha>` tag. */
export function buildComposeService(args: {
  serviceName: string;
  build: ParsedBuild;
  imageRepository: string;
  registry: typeof containerRegistry.$inferSelect | null;
  workDir: string;
  gitSha: string;
  cacheBuilder: string | null;
  sink: LogSink;
}): Promise<Result<string, BuildStepError>> {
  return Result.gen(async function* () {
    const { serviceName, build, imageRepository, registry, workDir, gitSha, cacheBuilder, sink } =
      args;
    const subdir = build.context.replace(/^\.\//, "").replace(/\/$/, "");
    const repoBase = `${imageRepository}-${serviceName}`.toLowerCase();
    const cachePath = cacheBuilder ? cachePathFor(repoBase) : null;

    const image = yield* await Result.tryPromise({
      try: () => {
        const resolution = resolveDockerfileBuild({
          builder: "auto",
          dockerfilePath: build.dockerfile ?? null,
          workDir,
          sourceSubdir: subdir || null,
        });
        for (const w of resolution.warnings) sink.system(w);
        if (resolution.kind === "dockerfile") {
          // Fail fast on unsupported instructions before docker runs.
          assertDockerfileValid(readFileSync(resolution.dockerfilePath, "utf8"), (m) =>
            sink.system(m),
          );
          return dockerfileBuild({
            workDir,
            sourceSubdir: subdir || null,
            dockerfilePath: resolution.dockerfilePath,
            contextDir: resolution.contextDir,
            relativePath: resolution.relativePath,
            imageRepository: repoBase,
            sha: gitSha,
            builderName: cacheBuilder,
            cachePath,
            sink,
          });
        }
        return railpackBuild({
          workDir,
          sourceSubdir: subdir || null,
          imageRepository: repoBase,
          sha: gitSha,
          config: null,
          builderName: cacheBuilder,
          cachePath,
          sink,
        });
      },
      catch: (cause) => new BuildStepError({ step: `build:${serviceName}`, cause }),
    });

    if (registry) {
      const password = yield* await Result.tryPromise({
        try: () => decryptSecret(registry.encryptedPassword),
        catch: (cause) => new BuildStepError({ step: "decrypt-registry", cause }),
      });
      yield* await Result.tryPromise({
        try: () =>
          dockerPush({
            tags: [image.shaTag, image.latestTag],
            credentials: {
              host: registry.host,
              username: registry.username,
              password,
            },
            sink,
          }),
        catch: (cause) => new BuildStepError({ step: `push:${serviceName}`, cause }),
      });
    } else {
      sink.system(`local build — skipping push for ${image.shaTag}`);
    }

    return Result.ok(image.shaTag);
  });
}
