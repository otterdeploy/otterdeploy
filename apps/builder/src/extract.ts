/**
 * Extract the CLI-uploaded source tarball for a `source: "upload"` build into a
 * fresh work dir — the tarball analogue of `cloneRepoAtSha`. The server stages
 * the tarball at `sourceTarballPath(projectId, deploymentId)` on the shared data
 * dir; the worker bind-mounts that file into this helper container at the same
 * path (see handler.ts), so it resolves here. Everything downstream
 * (railpack/Dockerfile, cache, push, rollout) is identical to the git path once
 * the work dir is populated — only source acquisition differs.
 */

import type { DeploymentId, ProjectId } from "@otterdeploy/shared/id";

import { sourceTarballPath } from "@otterdeploy/shared/paths";
import { stat } from "node:fs/promises";

import type { CloneResult } from "./clone";
import type { LogSink } from "./log-stream";

import { resolveWorkDir } from "./clone";
import { runProcess } from "./run-process";

export async function extractTarballToWorkDir(opts: {
  projectId: ProjectId;
  deploymentId: DeploymentId;
  sink: LogSink;
}): Promise<CloneResult> {
  const tarball = sourceTarballPath(opts.projectId, opts.deploymentId);
  const present = await stat(tarball)
    .then(() => true)
    .catch(() => false);
  if (!present) {
    // Almost always the shared-data-dir gate: the server staged the tarball
    // under DATA_ROOT but this helper never got it bind-mounted (no data folder
    // on the host), so an upload build can't run without a real data dir.
    throw new Error(
      `uploaded source not found at ${tarball} — is OTTERDEPLOY_DATA_DIR a real host dir shared with the builder?`,
    );
  }

  const { path: workDir, persistent } = await resolveWorkDir(opts.projectId, opts.deploymentId);
  opts.sink.system(`extracting uploaded source → ${workDir}`);

  const extracted = await runProcess({
    cmd: "tar",
    args: ["-xzf", tarball, "-C", workDir],
    sink: opts.sink,
  });
  if (extracted.exitCode !== 0) {
    throw new Error(
      `tar extract failed (exit ${extracted.exitCode}): ${extracted.tail.slice(0, 500)}`,
    );
  }

  // The tarball is mounted read-only and reclaimed by the worker after all
  // build attempts finish (so a retry can re-extract), so nothing to clean here.
  return { workDir, persistent };
}
