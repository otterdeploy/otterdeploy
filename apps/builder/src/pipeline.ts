/**
 * Build one deployment end-to-end.
 *
 *   load context  →  mark "building"
 *                 →  mint installation token
 *                 →  git clone @ sha
 *                 →  decrypt registry password
 *                 →  nixpacks build (tags: <repo>:<sha>, <repo>:latest)
 *                 →  docker login → docker push (both tags) → docker logout
 *                 →  mark image-ready (deployment.image = <repo>:<sha>)
 *                 →  serviceResource.image := <repo>:<sha>
 *                 →  redeployOne → swarm spec update → wait for converge
 *                 →  mark "running" (or "failed" on convergence error)
 *                 →  cleanup tmpfs work dir
 *
 * The function never throws to the caller — every failure is mapped to
 * `markFailed(deploymentId, …)` and a structured log line. The handler
 * iterates a batch of deployments and must keep going if one fails.
 */

import { rm } from "node:fs/promises";

import { getInstallationToken } from "@otterstack/api/git/github-app";
import { decryptSecret } from "@otterstack/api/lib/crypto";
import type { ResourceId } from "@otterstack/api/routers/service/errors";
import type { ProjectId } from "@otterstack/api/routers/project/errors";
import { redeployOne } from "@otterstack/api/routers/service/redeploy";
import { db } from "@otterstack/db";
import { serviceResource } from "@otterstack/db/schema";
import { eq } from "drizzle-orm";
import { log as globalLog } from "evlog";
import type { Redis } from "ioredis";

import { cloneRepoAtSha } from "./clone";
import { dockerPush } from "./docker-push";
import { loadPipelineContext, PipelineLoadError } from "./load";
import { createLogSink } from "./log-stream";
import { nixpacksBuild } from "./nixpacks";
import { markBuilding, markFailed, markImageReady, markRunning } from "./state";

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
    sink.system(`image-ready: ${built.shaTag} — updating swarm service`);

    // Point the service resource at the new image so the spec
    // assembled by redeployOne carries the freshly-pushed tag.
    // imageDigest is cleared — the builder doesn't currently capture
    // it and a stale digest would pin swarm to an older image than the
    // new tag points at.
    await db
      .update(serviceResource)
      .set({ image: built.shaTag, imageDigest: null })
      .where(eq(serviceResource.resourceId, ctx.resource.id as ResourceId));

    const redeployed = await redeployOne(
      ctx.project.id as ProjectId,
      ctx.resource.id as ResourceId,
      ctx.project.slug,
    );
    if (redeployed.isErr()) {
      throw new Error(`swarm update failed: ${redeployed.error.message}`);
    }
    const runtime = redeployed.value;
    sink.system(
      `swarm runtime: status=${runtime.status} health=${runtime.health ?? "n/a"}`,
    );
    if (runtime.status === "error") {
      throw new Error(
        `swarm convergence failed for service ${runtime.serviceName} (health=${runtime.health ?? "n/a"})`,
      );
    }

    await markRunning(opts.deploymentId);
    sink.system(`deployment running: ${built.shaTag}`);
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
