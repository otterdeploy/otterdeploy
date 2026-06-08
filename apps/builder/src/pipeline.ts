/**
 * Build one deployment end-to-end.
 *
 *   load context  →  mark "building"
 *                 →  mint installation token
 *                 →  git clone @ sha
 *                 →  railpack build (--load into host daemon) → tags: <repo>:<sha>, <repo>:latest
 *                 →  push to external registry IFF one is bound (else local-only)
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

import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { rm } from "node:fs/promises";

import { getInstallationToken } from "@otterdeploy/api/git/github-app";
import { decryptSecret } from "@otterdeploy/api/lib/crypto";

import { redeployOne } from "@otterdeploy/api/routers/service/redeploy";
import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema";
import type { RedisClient } from "bun";
import { eq } from "drizzle-orm";
import { log as globalLog } from "evlog";

import { cloneRepoAtSha } from "./clone";
import { dockerPush } from "./docker-push";
import { loadPipelineContext, PipelineLoadError } from "./load";
import { createLogSink } from "./log-stream";
import { railpackBuild } from "./railpack";
import { markBuilding, markFailed, markImageReady, markRunning } from "./state";

export async function runBuildPipeline(opts: {
  deploymentId: DeploymentId;
  publisher: RedisClient;
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
    // Public-URL bindings carry no installationId — we just clone over
    // anonymous HTTPS. Installation-backed bindings still mint a short-
    // lived token + inject it.
    const installationId = ctx.repo.installationId;
    const imageRepository = ctx.imageRepository;

    const installationToken = installationId
      ? (await getInstallationToken(installationId)).token
      : "";
    const cloned = await cloneRepoAtSha({
      cloneUrl: ctx.repo.cloneUrl,
      ref: gitRef,
      sha: gitSha,
      installationToken,
      sink,
    });
    workDir = cloned.workDir;

    // Railpack is the only builder: it analyses the repo, builds through its
    // BuildKit frontend, and `--load`s the result into the host daemon
    // (which, on a single-node swarm, is the same daemon the container runs
    // in). Static sites get a Caddy image with optional SPA fallback. The
    // railpack-shaped config only applies when explicitly chosen; auto/null
    // falls through to railpack's zero-config detection.
    const buildConfig = ctx.service.buildConfig;
    const railpackConfig =
      buildConfig?.builder === "railpack" ? buildConfig : null;
    const built = await railpackBuild({
      workDir: cloned.workDir,
      imageRepository,
      sha: gitSha,
      config: railpackConfig,
      sink,
    });

    // Push only when the project binds an external registry (remote or
    // multi-node swarm needs to pull it). The default path keeps the image
    // local — it's already `--load`ed into the swarm node's daemon.
    if (ctx.registry) {
      const password = await decryptSecret(ctx.registry.encryptedPassword);
      await dockerPush({
        tags: [built.shaTag, built.latestTag],
        credentials: {
          host: ctx.registry.host,
          username: ctx.registry.username,
          password,
        },
        sink,
      });
    } else {
      sink.system(`local build — skipping registry push for ${built.shaTag}`);
    }

    await markImageReady(opts.deploymentId, built.shaTag);
    sink.system(`image-ready: ${built.shaTag} — updating swarm service`);

    // Point the service resource at the new image so the spec assembled by
    // redeployOne carries the new tag. imageDigest is cleared — the builder
    // doesn't capture it, and a stale digest would pin swarm to an older
    // image than the tag points at (and the local-build path has no digest).
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
