/**
 * The image-build step: pick a builder and run it.
 *
 * Split out of pipeline-steps.ts so that file stays within the size budget.
 * Both paths — a repo Dockerfile via `docker buildx build`, or railpack's
 * BuildKit frontend — produce the same `{ shaTag, latestTag, buildDir }` shape
 * so everything downstream stays builder-agnostic.
 */

import type { Builder, BuildConfig } from "@otterdeploy/shared/build-config";

import { readFileSync } from "node:fs";

import type { TurboCacheEnv } from "./buildx";
import type { LogSink } from "./log-stream";

import { dockerfileBuild, resolveDockerfileBuild } from "./dockerfile";
import { assertDockerfileValid } from "./dockerfile-validate";
import { railpackBuild } from "./railpack";

/**
 * Build the service image. Two paths produce the same `{ shaTag, latestTag,
 * buildDir }` shape so the pipeline stays builder-agnostic: a repo Dockerfile
 * via `docker buildx build --load`, or railpack's BuildKit frontend. `auto`/
 * null resolves to dockerfile when one is present, else railpack. `compose`
 * resolves as railpack so the unsupported-builder fallback takes effect.
 */
export function runImageBuild(args: {
  buildConfig: BuildConfig | null;
  builder: Builder;
  workDir: string;
  sourceSubdir: string | null;
  imageRepository: string;
  gitSha: string;
  cacheBuilder: string | null;
  cachePath: string | null;
  /** Per-deploy cache bypass ("Redeploy without cache"). */
  noCache: boolean;
  /** Turbo remote-cache credentials, empty when disabled. */
  turboCache: TurboCacheEnv;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string }> {
  const { buildConfig, builder, workDir, sourceSubdir, imageRepository, gitSha } = args;
  const { cacheBuilder, cachePath, noCache, turboCache, sink } = args;
  // `compose` has no dockerfile config; resolve it as railpack.
  const resolveBuilderKind = builder === "compose" ? "railpack" : builder;
  const resolution = resolveDockerfileBuild({
    builder: resolveBuilderKind,
    dockerfilePath: buildConfig?.builder === "dockerfile" ? buildConfig.dockerfilePath : null,
    workDir,
    sourceSubdir,
    // A monorepo Dockerfile lives in the app's subdir but COPYs the root
    // lockfile + sibling packages, so the CONTEXT may need to be the repo root.
    dockerfileContext: buildConfig?.builder === "dockerfile" ? buildConfig.dockerfileContext : null,
  });
  for (const warning of resolution.warnings) sink.system(warning);

  if (resolution.kind === "dockerfile") {
    // Fail fast on unsupported instructions BEFORE invoking docker. A clear
    // `file:line + reason + fix` beats a silent-wrong build (the VOLUME case).
    assertDockerfileValid(readFileSync(resolution.dockerfilePath, "utf8"), (m) => sink.system(m));
    return dockerfileBuild({
      workDir,
      sourceSubdir,
      dockerfilePath: resolution.dockerfilePath,
      contextDir: resolution.contextDir,
      relativePath: resolution.relativePath,
      imageRepository,
      sha: gitSha,
      // Build-args only apply to the Dockerfile builder; an `auto` build that
      // resolves to a Dockerfile carries none (none configurable).
      buildArgs:
        buildConfig?.builder === "dockerfile" ? (buildConfig.buildArgs ?? undefined) : undefined,
      builderName: cacheBuilder,
      cachePath,
      noCache,
      sink,
    });
  }
  return railpackBuild({
    workDir,
    sourceSubdir,
    imageRepository,
    sha: gitSha,
    config: buildConfig?.builder === "railpack" ? buildConfig : null,
    builderName: cacheBuilder,
    cachePath,
    noCache,
    turboCache,
    sink,
  });
}
