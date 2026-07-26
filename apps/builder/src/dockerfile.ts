/**
 * Build an image from a repo-supplied Dockerfile with `docker buildx build`.
 *
 * Two output modes, chosen by the caller (`pipeline-steps.ts`):
 *   - PUSH mode (a registry is configured AND the remote buildkitd builder —
 *     see `buildx.ts` — is available): `--push` sends the built image
 *     straight from buildkitd to the registry. The result never touches the
 *     local docker daemon, so this build needs NO docker.sock access at all —
 *     confirmed locally by running the equivalent `buildx build --push`
 *     against a real registry with `DOCKER_HOST` pointed at a nonexistent
 *     socket. The digest is recovered from `--metadata-file`
 *     (`buildkit-metadata.ts`), not a local `docker inspect`.
 *   - LOAD mode (no registry, or the remote builder is unavailable): `--load`
 *     into the host daemon, same as before — the image must be locally
 *     present for the docker/swarm runtime to run it directly.
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

import { cleanupMetadataFile, readImageDigest, tmpMetadataFile } from "./buildkit-metadata";
import { builderFlags } from "./buildx";
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
 *
 * `push` (only takes effect alongside a `builderName`) swaps `--load` for
 * `--push` — the build goes straight from the remote buildkitd to the
 * registry, no local docker daemon involved. `metadataFile`, when set, adds
 * `--metadata-file` so the caller can recover `containerimage.digest` without
 * a `docker inspect` (there's no local image to inspect in push mode).
 */
export function dockerfileBuildArgs(opts: {
  dockerfilePath: string;
  contextDir: string;
  shaTag: string;
  latestTag: string;
  buildArgs?: Record<string, string>;
  /** Name of the remote buildkitd builder (`--builder`), or null for the
   *  default driver. */
  builderName?: string | null;
  /** Push straight to the registry instead of `--load`ing locally. Ignored
   *  (silently) without `builderName` — the default driver can only `--load`. */
  push?: boolean;
  /** `--metadata-file` output path; only meaningful in push mode. */
  metadataFile?: string | null;
}): string[] {
  const buildArgs = opts.buildArgs ?? {};
  const buildArgFlags = Object.entries(buildArgs).flatMap(([key, value]) => [
    "--build-arg",
    `${key}=${value}`,
  ]);
  const pushMode = !!(opts.push && opts.builderName);
  return [
    "buildx",
    "build",
    ...builderFlags(opts.builderName),
    "-f",
    opts.dockerfilePath,
    pushMode ? "--push" : "--load",
    "--progress",
    "plain",
    "-t",
    opts.shaTag,
    "-t",
    opts.latestTag,
    ...buildArgFlags,
    ...(pushMode && opts.metadataFile ? ["--metadata-file", opts.metadataFile] : []),
    opts.contextDir,
  ];
}

/**
 * Build an image from a Dockerfile, either `--push`ing it straight to a
 * registry through the remote buildkitd or `--load`ing it into the host
 * daemon (see `dockerfileBuildArgs`). Mirrors `railpackBuild`'s
 * signature/return so the pipeline branches yield the same shape. Throws a
 * plain Error on a non-zero exit — the pipeline's `step()` wrapper converts it
 * to a tagged BuildStepError (same idiom as railpack.ts).
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
  /** Remote buildkitd builder name, or null for the default driver. */
  builderName?: string | null;
  /** Push straight to the registry (needs `builderName` + a `docker login`
   *  the caller has already run) instead of `--load`ing locally. */
  push?: boolean;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string; digest: string | null }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;
  const pushMode = !!(opts.push && opts.builderName);
  const metadataFile = pushMode ? await tmpMetadataFile() : null;

  opts.sink.system(
    pushMode
      ? `building + pushing image ${shaTag} from ${opts.relativePath} (no local docker daemon involved)`
      : `building image ${shaTag} from ${opts.relativePath}`,
  );
  try {
    const built = await runProcess({
      cmd: "docker",
      args: dockerfileBuildArgs({
        dockerfilePath: opts.dockerfilePath,
        contextDir: opts.contextDir,
        shaTag,
        latestTag,
        buildArgs: opts.buildArgs ?? {},
        builderName: opts.builderName,
        push: pushMode,
        metadataFile,
      }),
      sink: opts.sink,
    });
    if (built.exitCode !== 0) {
      throw new Error(`dockerfile build failed (exit ${built.exitCode})`);
    }

    const digest = metadataFile ? await readImageDigest(metadataFile) : null;
    return { shaTag, latestTag, buildDir: opts.contextDir, digest };
  } finally {
    if (metadataFile) await cleanupMetadataFile(metadataFile);
  }
}
