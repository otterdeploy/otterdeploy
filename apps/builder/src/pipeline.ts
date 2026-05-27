/**
 * Build one deployment end-to-end.
 *
 *   load context  →  mark "building"
 *                 →  mint installation token
 *                 →  git clone @ sha
 *                 →  decrypt registry password
 *                 →  nixpacks build (tags: <repo>:<sha>, <repo>:latest)
 *                 →  docker login → docker push (both tags) → docker logout
 *                 →  mark image-ready (image column = <repo>:<sha>)
 *                 →  cleanup tmpfs work dir
 *
 * The function never throws to the caller — every failure is mapped to
 * `markFailed(deploymentId, …)` and a structured log line. The handler
 * iterates a batch of deployments and must keep going if one fails.
 */

import { rm } from "node:fs/promises";

import { getInstallationToken } from "@otterstack/api/git/github-app";
import { decryptSecret } from "@otterstack/api/lib/crypto";
import { log as globalLog } from "evlog";
import type { Redis } from "ioredis";

import { cloneRepoAtSha } from "./clone";
import { dockerPush } from "./docker-push";
import { loadPipelineContext, PipelineLoadError } from "./load";
import { createLogSink } from "./log-stream";
import { nixpacksBuild } from "./nixpacks";
import { markBuilding, markFailed, markImageReady } from "./state";

import type { Id, ID_PREFIX } from "@otterstack/shared/id";

type DeploymentId = Id<typeof ID_PREFIX.deployment>;

export async function runBuildPipeline(opts: {
  deploymentId: DeploymentId;
  publisher: Redis;
}): Promise<{ ok: true; image: string } | { ok: false; error: string }> {
  const sink = createLogSink({ deploymentId: opts.deploymentId, publisher: opts.publisher });
  let workDir: string | null = null;

  try {
    const ctx = await loadPipelineContext(opts.deploymentId);
    await markBuilding(opts.deploymentId);
    sink.system(
      `build start: project=${ctx.project.slug} resource=${ctx.resource.name} sha=${ctx.deployment.gitSha ?? "unknown"}`,
    );

    const { gitSha, gitRef } = ctx.deployment;
    if (!gitSha || !gitRef) {
      throw new Error("deployment has no gitSha / gitRef — not a git-triggered build");
    }
    // loadPipelineContext already rejected nulls — narrow here so the
    // type system follows.
    const installationId = ctx.repo.installationId;
    const imageRepository = ctx.project.imageRepository;
    if (!installationId || !imageRepository) {
      throw new Error("internal: load yielded incomplete context");
    }

    const tokenResp = await getInstallationToken(installationId);
    const cloned = await cloneRepoAtSha({
      cloneUrl: ctx.repo.cloneUrl,
      ref: gitRef,
      sha: gitSha,
      installationToken: tokenResp.token,
      sink,
    });
    workDir = cloned.workDir;

    const password = await decryptSecret(ctx.registry.encryptedPassword);

    const built = await nixpacksBuild({
      workDir: cloned.workDir,
      imageRepository,
      sha: gitSha,
      config: ctx.project.nixpacksConfig ?? null,
      sink,
    });

    await dockerPush({
      tags: [built.shaTag, built.latestTag],
      credentials: {
        host: ctx.registry.host,
        username: ctx.registry.username,
        password,
      },
      sink,
    });

    await markImageReady(opts.deploymentId, built.shaTag);
    sink.system(
      `image-ready: ${built.shaTag} (swarm service update lands in phase 3c — deployment will remain in "building" until then)`,
    );
    return { ok: true, image: built.shaTag };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sink.system(`build failed: ${message}`);
    await markFailed(opts.deploymentId, message).catch((stateErr) => {
      globalLog.error({
        build: { event: "mark-failed-failed", deploymentId: opts.deploymentId },
        error: stateErr instanceof Error ? stateErr.message : String(stateErr),
      } as Record<string, unknown>);
    });
    if (err instanceof PipelineLoadError) {
      globalLog.warn({
        build: {
          event: "load-failed",
          deploymentId: opts.deploymentId,
          step: err.step,
        },
        error: message,
      } as Record<string, unknown>);
    }
    return { ok: false, error: message };
  } finally {
    await sink.close();
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
