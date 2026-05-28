/**
 * Invoke `nixpacks build` on a checked-out work tree.
 *
 * Nixpacks emits a Dockerfile-like build plan from the source directory
 * (Node, Python, Go, Rust auto-detected), invokes Docker BuildKit
 * under the hood, and tags the resulting image with whatever `--name`
 * we hand it.
 *
 * The CLI surface used here is intentionally minimal — Nixpacks has
 * many knobs, but every additional flag is a UI/schema commitment.
 * For now we expose:
 *   - buildCmd / startCmd / installCmd → `--build-cmd` / `--start-cmd` / `--install-cmd`
 *   - packages → repeated `--pkgs`
 *   - aptPackages → repeated `--apt`
 *   - env → repeated `--env KEY=VALUE`
 *
 * Two tags are produced for every successful build: the immutable
 * `:<sha>` tag (what the deployment row points at) and the moving
 * `:latest` tag (a convenience for `docker run` operators).
 */

import type { NixpacksConfig } from "@otterdeploy/db/schema";

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

export async function nixpacksBuild(opts: {
  workDir: string;
  /** Full image reference without tag, e.g. "ghcr.io/acme/api". */
  imageRepository: string;
  sha: string;
  config: NixpacksConfig | null;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string }> {
  const shaTag = `${opts.imageRepository}:${opts.sha}`;
  const latestTag = `${opts.imageRepository}:latest`;

  const args = buildNixpacksArgs({
    workDir: opts.workDir,
    shaTag,
    latestTag,
    config: opts.config,
  });

  opts.sink.system(`building image ${shaTag} with nixpacks`);
  const res = await runProcess({
    cmd: "nixpacks",
    args,
    sink: opts.sink,
  });
  if (res.exitCode !== 0) {
    throw new Error(`nixpacks build failed (exit ${res.exitCode})`);
  }
  return { shaTag, latestTag };
}

function buildNixpacksArgs(opts: {
  workDir: string;
  shaTag: string;
  latestTag: string;
  config: NixpacksConfig | null;
}): string[] {
  const args: string[] = [
    "build",
    opts.workDir,
    "--name",
    opts.shaTag,
    "--tag",
    opts.latestTag,
  ];
  const cfg = opts.config;
  if (!cfg) return args;
  if (cfg.buildCmd) args.push("--build-cmd", cfg.buildCmd);
  if (cfg.startCmd) args.push("--start-cmd", cfg.startCmd);
  if (cfg.installCmd) args.push("--install-cmd", cfg.installCmd);
  for (const pkg of cfg.packages ?? []) args.push("--pkgs", pkg);
  for (const pkg of cfg.aptPackages ?? []) args.push("--apt", pkg);
  for (const [k, v] of Object.entries(cfg.env ?? {})) args.push("--env", `${k}=${v}`);
  return args;
}
