/**
 * Build (and optionally push) a single `build:` service of a compose stack.
 *
 * Split out of `compose-build.ts` so the per-service step is self-contained:
 * it resolves the build method (Dockerfile vs Railpack) for the service's
 * context subdir, builds its own image (`<repo>-<service>:<sha>`), and pushes
 * to the bound registry when one exists. Returns the immutable `:<sha>` tag the
 * stack will reference. Mirrors the pipeline's single-service builder.
 */

import { type ParsedBuild } from "@otterdeploy/api/stack/compose/types";
import { Result } from "better-result";
import { readFileSync } from "node:fs";

import type { LogSink } from "./log-stream";

import { cachePathFor } from "./buildx";
import { dockerPush } from "./docker-push";
import { dockerfileBuild, resolveDockerfileBuild } from "./dockerfile";
import { assertDockerfileValid } from "./dockerfile-validate";
import { BuildStepError } from "./errors";
import { railpackBuild } from "./railpack";
import { type RegistryCredentialSource, resolvePushCredentials } from "./registry-credential";

/** Build one compose `build:` service to its own image and push it when the
 *  stack binds an external registry. Resolves to the `:<sha>` tag. */
export function buildComposeService(args: {
  serviceName: string;
  build: ParsedBuild;
  imageRepository: string;
  registry: RegistryCredentialSource | null;
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
      // Resolved immediately before the push: a GitHub-App-derived GHCR token
      // expires in about an hour, and a compose stack builds one service at a
      // time, so the last service may push long after the first.
      const credentials = yield* await Result.tryPromise({
        try: () => resolvePushCredentials(registry),
        catch: (cause) => new BuildStepError({ step: "resolve-registry", cause }),
      });
      yield* await Result.tryPromise({
        try: () => dockerPush({ tags: [image.shaTag, image.latestTag], credentials, sink }),
        catch: (cause) => new BuildStepError({ step: `push:${serviceName}`, cause }),
      });
    } else {
      sink.system(`local build; skipping push for ${image.shaTag}`);
    }

    return Result.ok(image.shaTag);
  });
}
