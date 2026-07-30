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

import type { Builder } from "@otterdeploy/shared/build-config";

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { LogSink } from "./log-stream";

import { builderFlags, cacheFlags } from "./buildx";
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

const railpack = (extraWarnings: string[] = []): DockerfileResolution => ({
  kind: "railpack",
  warnings: extraWarnings,
});

/** Builder pinned to railpack: always railpack, but warn when a Dockerfile (or
 *  a custom path) is present so the pin isn't a silent surprise. */
function resolveRailpackPin(appDir: string, customPath: string): DockerfileResolution {
  if (customPath || existsSync(join(appDir, DEFAULT_DOCKERFILE))) {
    return railpack([
      "A Dockerfile is present, but this service is pinned to Railpack. Set the build method to Auto or Dockerfile to use it.",
    ]);
  }
  return railpack();
}

/**
 * Files that mark a directory as the root of something buildable. Not a
 * detection list — railpack owns that — just "a human put a project here".
 */
const PROJECT_MANIFESTS = [
  "package.json",
  DEFAULT_DOCKERFILE,
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "mix.exs",
  "deno.json",
];

/**
 * Warn about a `sourceSubdir` that is probably not what the operator meant.
 *
 * Both checks come from one incident. A service was configured with root
 * directory `client` — a folder holding `index.html` and `src/`, but no
 * `package.json` (it sits at the repo root) and no Dockerfile (also at the
 * repo root). Auto-resolution looked only inside `client`, found no Dockerfile,
 * and handed off to railpack; railpack's node provider needs a `package.json`,
 * so it fell through to the Staticfile provider, which matched on `index.html`
 * and produced a Caddy image serving a `dist/` that nothing ever built. Every
 * request 404'd, and the deployment was reported as successful.
 *
 * Every fact needed to catch that was on disk before the build started. The
 * mirror case — railpack pinned while a Dockerfile is present — has warned all
 * along (see resolveRailpackPin); a subdir *hiding* the Dockerfile was the gap.
 */
function diagnoseSubdir(workDir: string, subdir: string, appDir: string): string[] {
  const warnings: string[] = [];

  if (isFile(join(workDir, DEFAULT_DOCKERFILE))) {
    warnings.push(
      `Found a Dockerfile at the repository root, but the root directory is set to "${subdir}", ` +
        `which has none — building with Railpack instead. Clear the root directory to use it.`,
    );
  }

  if (!PROJECT_MANIFESTS.some((name) => isFile(join(appDir, name)))) {
    warnings.push(
      `Root directory "${subdir}" contains no project manifest ` +
        `(${PROJECT_MANIFESTS.slice(0, 3).join(", ")}, …). ` +
        `Railpack may not detect the right builder for it.`,
    );
  }

  return warnings;
}

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

  // Pinned to railpack: never build the Dockerfile, but don't let a present
  // Dockerfile (or a set custom path) be a silent surprise.
  if (builder === "railpack") {
    return resolveRailpackPin(appDir, customPath);
  }

  // From here: builder is "dockerfile" or "auto". A "dockerfile" pin makes a
  // bad path a HARD error; "auto" warns + falls back to railpack.
  if (isAbsolute(relativePath)) {
    if (builder === "dockerfile") {
      throw new Error(`Dockerfile path must be relative to the repository, got: ${relativePath}`);
    }
    return railpack([`Ignoring absolute Dockerfile path ${relativePath}; using Railpack instead.`]);
  }

  const resolvedPath = resolve(appDir, relativePath);
  const escapesAppDir = relative(resolve(appDir), resolvedPath).startsWith("..");
  if (escapesAppDir) {
    if (builder === "dockerfile") {
      throw new Error(`Dockerfile path ${relativePath} points outside the repository.`);
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
    // A subdir can hide the very Dockerfile that would have been chosen, so
    // diagnose it on every fall-through to railpack — including the custom-path
    // miss, where the wrong root directory is a likely cause of the miss.
    const subdirWarnings = subdir ? diagnoseSubdir(opts.workDir, subdir, appDir) : [];
    if (customPath) {
      return railpack([
        `Custom Dockerfile path ${customPath} was not found; falling back to Railpack.`,
        ...subdirWarnings,
      ]);
    }
    return railpack(subdirWarnings);
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
  /** Name of the docker-container cache builder (`--builder`), or null for the
   *  default driver. */
  builderName?: string | null;
  /** Local BuildKit cache dir; only honored alongside `builderName`. */
  cachePath?: string | null;
}): string[] {
  const buildArgs = opts.buildArgs ?? {};
  const buildArgFlags = Object.entries(buildArgs).flatMap(([key, value]) => [
    "--build-arg",
    `${key}=${value}`,
  ]);
  return [
    "buildx",
    "build",
    ...builderFlags(opts.builderName),
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
    ...cacheFlags(opts.builderName, opts.cachePath),
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
  /** Cache builder name + local cache dir (best-effort; both or neither). */
  builderName?: string | null;
  cachePath?: string | null;
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
      builderName: opts.builderName,
      cachePath: opts.cachePath,
    }),
    sink: opts.sink,
  });
  if (built.exitCode !== 0) {
    throw new Error(`dockerfile build failed (exit ${built.exitCode})`);
  }

  return { shaTag, latestTag, buildDir: opts.contextDir };
}
