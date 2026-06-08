/**
 * Build an image from a checked-out work tree with Railpack.
 *
 * Unlike nixpacks (which shells out to a single `nixpacks build` that
 * loads straight into the local Docker daemon), Railpack is a two-step,
 * BuildKit-native flow:
 *
 *   1. `railpack prepare <dir> --plan-out <dir>/railpack-plan.json`
 *      Analyses the source and emits a BuildKit plan.
 *   2. `docker buildx build --build-arg BUILDKIT_SYNTAX=<frontend>
 *         -f <plan> --load -t <sha> -t <latest> <dir>`
 *      Executes the plan through Railpack's BuildKit frontend and
 *      `--load`s the result into the local Docker daemon, so the
 *      existing `dockerPush` step pushes it unchanged.
 *
 * For static sites (Vite / React / Vue / Angular) Railpack produces an
 * image that runs Caddy to serve the built assets with SPA history
 * fallback. Railpack keys this off the `RAILPACK_SPA_OUTPUT_DIR` env var
 * (read at `prepare` time) pointing at the build output dir — NOT the
 * Cloud-Foundry-style `Staticfile` that nixpacks used; railpack ignores
 * that file. When `spa` is set we pass `--env RAILPACK_SPA_OUTPUT_DIR=
 * <staticRoot>` to `prepare` (default `dist`, Vite's output).
 *
 * Two tags are produced for every successful build: the immutable
 * `:<sha>` tag (what the deployment row points at) and the moving
 * `:latest` tag.
 */

import { join } from "node:path";

import type { BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

/** Pinned in one place so the buildx `--build-arg` and any future
 *  buildctl path agree on the frontend image. */
const RAILPACK_FRONTEND = "ghcr.io/railwayapp/railpack-frontend";

/** Vite's default output dir; overridable via `config.staticRoot` for
 *  frameworks that emit elsewhere (e.g. CRA's `build`). */
const DEFAULT_STATIC_ROOT = "dist";

export async function railpackBuild(opts: {
  workDir: string;
  /** Full image reference without tag, e.g. "ghcr.io/acme/web". */
  imageRepository: string;
  sha: string;
  config: BuildRailpackConfig | null;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;
  const planPath = join(opts.workDir, "railpack-plan.json");

  opts.sink.system(`preparing railpack plan for ${shaTag}`);
  const prepareArgs = ["prepare", opts.workDir, "--plan-out", planPath];
  if (opts.config?.buildCommand) {
    prepareArgs.push("--build-cmd", opts.config.buildCommand);
  }
  // Static SPA: railpack emits a Caddy image serving the built assets with
  // history fallback when RAILPACK_SPA_OUTPUT_DIR names the build output dir.
  // It's read at prepare time, so it has to ride on the `prepare` invocation.
  if (opts.config?.spa) {
    const root = opts.config.staticRoot?.trim() || DEFAULT_STATIC_ROOT;
    prepareArgs.push("--env", `RAILPACK_SPA_OUTPUT_DIR=${root}`);
    opts.sink.system(
      `SPA mode: serving "${root}" via Caddy with history fallback`,
    );
  }
  const prepared = await runProcess({
    cmd: "railpack",
    args: prepareArgs,
    sink: opts.sink,
  });
  if (prepared.exitCode !== 0) {
    throw new Error(`railpack prepare failed (exit ${prepared.exitCode})`);
  }

  opts.sink.system(`building image ${shaTag} with railpack`);
  const built = await runProcess({
    cmd: "docker",
    args: [
      "buildx",
      "build",
      "--build-arg",
      `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND}`,
      "-f",
      planPath,
      "--load",
      "-t",
      shaTag,
      "-t",
      latestTag,
      opts.workDir,
    ],
    sink: opts.sink,
  });
  if (built.exitCode !== 0) {
    throw new Error(`railpack build failed (exit ${built.exitCode})`);
  }

  return { shaTag, latestTag };
}
