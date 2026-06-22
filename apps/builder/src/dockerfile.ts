/**
 * Build an image from a repo-supplied Dockerfile with `docker buildx build`.
 *
 * Unlike railpack (which analyses the source and runs through a BuildKit
 * frontend), the Dockerfile builder hands a user-authored Dockerfile straight
 * to `docker buildx build --load` and `--load`s the result into the host
 * daemon, so the existing `dockerPush` step pushes it unchanged — same flow as
 * railpack.ts. We deliberately use host-daemon `buildx --load`, NOT a remote
 * buildkit container, to stay consistent with railpack.ts.
 *
 * Resolution lives in `resolveDockerfileBuild` — a pure, read-only probe of the
 * checked-out work tree (no docker, no side effects) so the pipeline can decide
 * between dockerfile and railpack and surface warnings BEFORE building:
 *
 *   - builder "dockerfile": a missing/absolute/escaping path is a HARD error
 *     (thrown — the pipeline's `step()` wrapper tags it a BuildStepError).
 *   - builder "auto": a Dockerfile present → dockerfile; absent → railpack; a
 *     bad custom path → warn + fall back to railpack.
 *   - builder "railpack": always railpack, but warn when a Dockerfile is
 *     present (or a custom path is set) so the pin isn't a silent surprise.
 *
 * Path resolution + the build context are both anchored at `appDir` — the
 * service's subdir if `sourceSubdir` is set, else the repo root.
 *
 * Two tags are produced for every successful build: the immutable `:<sha>` tag
 * (what the deployment row points at) and the moving `:latest` tag — exactly
 * like railpack.ts.
 *
 * Path-safety guards ported from research/aeroplane/src/server/dockerfile-build.ts;
 * aeroplane's env-override channel is dropped (we have no such channel).
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { Builder } from "@otterdeploy/shared/build-config";

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

/** Default Dockerfile name, relative to `appDir`, when no custom path is set. */
const DEFAULT_DOCKERFILE = "Dockerfile";

/** Resolution result: build via Dockerfile, or fall through to railpack. Both
 *  carry `warnings` to surface before building. */
export type DockerfileResolution =
  | {
      kind: "dockerfile";
      /** Absolute path to the resolved Dockerfile. */
      dockerfilePath: string;
      /** Build context + base for path resolution (= appDir). */
      contextDir: string;
      /** Dockerfile path relative to `contextDir`, for logs. */
      relativePath: string;
      warnings: string[];
    }
  | { kind: "railpack"; warnings: string[] };

/** True when `path` exists and is a regular file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Decide whether to build with the repo's Dockerfile or fall through to
 * railpack. PURE + read-only (node:fs existsSync/statSync only) — no docker,
 * no writes — so the pipeline can resolve + warn before invoking docker.
 *
 * `appDir` is the build context AND the base for path resolution: the service's
 * subdir if `sourceSubdir` is set, else the repo root.
 *
 * Throws (HARD) on a bad path only when `builder === "dockerfile"`; under
 * `auto` the same conditions warn + fall back to railpack.
 */
export function resolveDockerfileBuild(opts: {
  builder: Builder;
  dockerfilePath: string | null | undefined;
  workDir: string;
  sourceSubdir: string | null | undefined;
}): DockerfileResolution {
  const { builder } = opts;
  const subdir = opts.sourceSubdir?.trim();
  const appDir = subdir ? join(opts.workDir, subdir) : opts.workDir;

  const customPath = opts.dockerfilePath?.trim() || "";
  const relativePath = customPath || DEFAULT_DOCKERFILE;

  const railpack = (extraWarnings: string[] = []): DockerfileResolution => ({
    kind: "railpack",
    warnings: extraWarnings,
  });

  // Pinned to railpack: never build the Dockerfile, but don't let a present
  // Dockerfile (or a set custom path) be a silent surprise.
  if (builder === "railpack") {
    if (customPath || existsSync(join(appDir, DEFAULT_DOCKERFILE))) {
      return railpack([
        "A Dockerfile is present, but this service is pinned to Railpack. Set the build method to Auto or Dockerfile to use it.",
      ]);
    }
    return railpack();
  }

  // From here: builder is "dockerfile" or "auto". A "dockerfile" pin makes a
  // bad path a HARD error; "auto" warns + falls back to railpack.
  if (isAbsolute(relativePath)) {
    if (builder === "dockerfile") {
      throw new Error(
        `Dockerfile path must be relative to the repository, got: ${relativePath}`,
      );
    }
    return railpack([
      `Ignoring absolute Dockerfile path ${relativePath}; using Railpack instead.`,
    ]);
  }

  const resolvedPath = resolve(appDir, relativePath);
  const escapesAppDir = relative(resolve(appDir), resolvedPath).startsWith(
    "..",
  );
  if (escapesAppDir) {
    if (builder === "dockerfile") {
      throw new Error(
        `Dockerfile path ${relativePath} points outside the repository.`,
      );
    }
    return railpack([
      `Ignoring Dockerfile path ${relativePath} because it points outside the repository; using Railpack instead.`,
    ]);
  }

  if (!isFile(resolvedPath)) {
    if (builder === "dockerfile") {
      throw new Error(
        `Build method is set to Dockerfile, but ${relativePath} was not found in the repository.`,
      );
    }
    if (customPath) {
      return railpack([
        `Custom Dockerfile path ${customPath} was not found; falling back to Railpack.`,
      ]);
    }
    return railpack();
  }

  return {
    kind: "dockerfile",
    dockerfilePath: resolvedPath,
    contextDir: appDir,
    relativePath,
    warnings: [],
  };
}

/**
 * Build the `docker` argv for a Dockerfile build. PURE — no side effects — so
 * it's testable without invoking docker. `buildArgs` is the service's
 * configured Dockerfile build-args (`BuildDockerfileConfig.buildArgs`), emitted
 * as `--build-arg key=value`; defaults to {} when none are set.
 */
export function dockerfileBuildArgs(opts: {
  dockerfilePath: string;
  contextDir: string;
  shaTag: string;
  latestTag: string;
  buildArgs?: Record<string, string>;
}): string[] {
  const buildArgs = opts.buildArgs ?? {};
  const buildArgFlags = Object.entries(buildArgs).flatMap(([key, value]) => [
    "--build-arg",
    `${key}=${value}`,
  ]);
  return [
    "buildx",
    "build",
    "-f",
    opts.dockerfilePath,
    "--load",
    "--progress",
    "plain",
    "-t",
    opts.shaTag,
    "-t",
    opts.latestTag,
    ...buildArgFlags,
    opts.contextDir,
  ];
}

/**
 * Build an image from a Dockerfile and `--load` it into the host daemon.
 * Mirrors `railpackBuild`'s signature/return so the pipeline branches yield the
 * same shape. Throws a plain Error on a non-zero exit — the pipeline's `step()`
 * wrapper converts it to a tagged BuildStepError (same idiom as railpack.ts).
 */
export async function dockerfileBuild(opts: {
  workDir: string;
  sourceSubdir: string | null;
  dockerfilePath: string;
  contextDir: string;
  relativePath: string;
  /** Full image reference without tag, e.g. "ghcr.io/acme/web". */
  imageRepository: string;
  sha: string;
  /** Configured `--build-arg`s from `BuildDockerfileConfig.buildArgs`. */
  buildArgs?: Record<string, string>;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;

  opts.sink.system(`building image ${shaTag} from ${opts.relativePath}`);
  const built = await runProcess({
    cmd: "docker",
    args: dockerfileBuildArgs({
      dockerfilePath: opts.dockerfilePath,
      contextDir: opts.contextDir,
      shaTag,
      latestTag,
      buildArgs: opts.buildArgs ?? {},
    }),
    sink: opts.sink,
  });
  if (built.exitCode !== 0) {
    throw new Error(`dockerfile build failed (exit ${built.exitCode})`);
  }

  return { shaTag, latestTag, buildDir: opts.contextDir };
}
