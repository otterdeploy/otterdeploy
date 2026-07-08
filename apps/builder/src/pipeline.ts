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
 * The build sequence is a `Result.gen` flow: every fallible step yields a
 * tagged error (see `./errors` + `PipelineLoadError`) rather than throwing a
 * bare `Error`, so `runBuildSteps` returns a typed `Result` instead of
 * rejecting. The pipeline never throws to the caller — a failure marks the row
 * failed + logs, and surfaces the message. The handler iterates a batch of
 * deployments and must keep going if one fails. The individual steps live in
 * `./pipeline-steps`.
 */

import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RedisClient } from "bun";

import { isPreviewActive, loadPreviewScope } from "@otterdeploy/api/lib/environment/load";
import { redeployOne } from "@otterdeploy/api/routers/service/redeploy";
import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";

import { pruneStaleBuildCache, pruneStaleBuilds } from "./build-workdir";
import { ensureBuildxBuilder, cachePathFor } from "./buildx";
import { cloneRepoAtSha } from "./clone";
import { isComposeDeployment, runComposeBuild } from "./compose-build";
import { detectServiceFramework } from "./detect-framework";
import {
  BuildStepError,
  InvalidDeploymentError,
  SwarmConvergenceError,
  SwarmUpdateError,
} from "./errors";
import { loadPipelineContext, PipelineLoadError } from "./load";
import { createLogSink, type LogSink } from "./log-stream";
import {
  type BuildPipelineError,
  handleFailure,
  mintInstallationToken,
  pushImageIfRegistry,
  resolveBindingKind,
  resolveBuilder,
  runImageBuild,
  runPostDeploy,
  runPreDeploy,
  step,
} from "./pipeline-steps";
import { markBuilding, markImageReady, markRunning } from "./state";

/** Mutable holder for the clone's work dir, so cleanup can remove it even
 *  when a later step fails (the dir is created mid-pipeline). */
interface WorkDirRef {
  path: string | null;
  /** True when `path` is under the data folder → a failed build's clone is kept
   *  for inspection rather than cleaned. */
  persistent: boolean;
}

/** On success the value is the immutable `:<sha>` image tag the deployment
 *  now points at; on failure it's the surfaced error message (the row has
 *  already been marked failed). The pipeline never rejects — a batch handler
 *  must keep going if one deployment fails. */
export async function runBuildPipeline(opts: {
  deploymentId: DeploymentId;
  publisher: RedisClient;
}): Promise<Result<string, string>> {
  const sink = createLogSink({ deploymentId: opts.deploymentId, publisher: opts.publisher });
  const work: WorkDirRef = { path: null, persistent: false };

  // Reclaim disk before we start (no-op unless the data folder is in use): old
  // kept-on-failure clones, and BuildKit layer-cache dirs unused past their TTL
  // (the cache has no GC of its own).
  await pruneStaleBuilds().catch(() => undefined);
  await pruneStaleBuildCache().catch(() => undefined);

  const built = await runBuildSteps(opts, sink, work);

  // On failure: mark the row + log (side effects via tapErrorAsync, runs only
  // on Err and passes the Result through), then collapse the tagged error to
  // its message for the caller.
  const outcome = (
    await built.tapErrorAsync((err) => handleFailure(opts.deploymentId, sink, err))
  ).mapError((err) => err.message);

  // Successful builds + ephemeral (tmpdir) work dirs are cleaned immediately. A
  // FAILED build under the data folder is KEPT for inspection; the TTL sweep
  // above reclaims it after BUILD_TTL_MS.
  if (work.path) {
    if (outcome.isErr() && work.persistent) {
      sink.system(`build failed — work dir kept for inspection: ${work.path}`);
    } else {
      await rm(work.path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  await sink.close();
  return outcome;
}

/** The build sequence as a Result flow — each `yield*` unwraps an Ok value or
 *  short-circuits the whole flow with its tagged error. Returns the immutable
 *  `:<sha>` image tag the deployment now points at. */
function runBuildSteps(
  opts: { deploymentId: DeploymentId; publisher: RedisClient },
  sink: LogSink,
  work: WorkDirRef,
): Promise<Result<string, BuildPipelineError>> {
  return Result.gen(async function* () {
    // Compose stacks build N services from one repo — a separate path that
    // reuses the same builders per build-context. Image-only stacks never
    // enqueue a build, so reaching here means there's at least one `build:`.
    const isCompose = yield* await Result.tryPromise({
      try: () => isComposeDeployment(opts.deploymentId),
      catch: (cause): BuildPipelineError => new BuildStepError({ step: "dispatch", cause }),
    });
    if (isCompose) {
      return await runComposeBuild(opts, sink, work);
    }

    // loadPipelineContext throws PipelineLoadError (already tagged) on a bad
    // row; keep that tag and wrap anything else as a generic load failure.
    const ctx = yield* await Result.tryPromise({
      try: () => loadPipelineContext(opts.deploymentId),
      catch: (cause): BuildPipelineError =>
        cause instanceof PipelineLoadError ? cause : new BuildStepError({ step: "load", cause }),
    });

    yield* await step("mark-building", () => markBuilding(opts.deploymentId));
    sink.system(
      `build start: project=${ctx.project.slug} resource=${ctx.resource.name} sha=${ctx.deployment.gitSha ?? "unknown"}`,
    );

    const { gitSha, gitRef } = ctx.deployment;
    if (!gitSha || !gitRef) {
      return Result.err(new InvalidDeploymentError(opts.deploymentId));
    }

    // Public-URL bindings carry no installationId — clone over anonymous HTTPS.
    // Installation-backed bindings mint a short-lived token + inject it. Use the
    // GitHub-side numeric id (resolved in load.ts), NOT repo.installationId,
    // which is the internal git_installation.id FK the token API can't resolve.
    const installationId = ctx.githubInstallationId;
    const bindingKind = resolveBindingKind(installationId, ctx.repo.isPrivate);
    const installationToken = yield* await mintInstallationToken(installationId);

    const cloned = yield* await step("clone", () =>
      cloneRepoAtSha({
        cloneUrl: ctx.repo.cloneUrl,
        ref: gitRef,
        sha: gitSha,
        projectId: ctx.project.id as ProjectId,
        deploymentId: opts.deploymentId,
        installationToken,
        bindingKind,
        sink,
      }),
    );
    work.path = cloned.workDir;
    work.persistent = cloned.persistent;

    // Pick the builder, then build. Both the dockerfile and railpack paths
    // produce the same `{ shaTag, latestTag, buildDir }` shape so everything
    // below stays builder-agnostic.
    const builder = resolveBuilder(ctx.service.buildConfig, sink);

    // Best-effort persistent layer cache: when a docker-container buildx builder
    // can be set up, route the build through it with a local cache keyed by the
    // image repo. Returns null (→ no cache, default-driver `--load`) on any
    // failure, so a build never depends on the cache being available.
    const cacheBuilder = await ensureBuildxBuilder(sink);
    const cachePath = cacheBuilder ? cachePathFor(ctx.imageRepository) : null;

    // Resolve inside the build step so any HARD throw (bad/missing Dockerfile
    // path when pinned to dockerfile) becomes a tagged BuildStepError.
    const image = yield* await step("build", () =>
      runImageBuild({
        buildConfig: ctx.service.buildConfig,
        builder,
        workDir: cloned.workDir,
        sourceSubdir: ctx.service.sourceSubdir,
        imageRepository: ctx.imageRepository,
        gitSha,
        cacheBuilder,
        cachePath,
        sink,
      }),
    );

    // Push only when the project binds an external registry (remote/multi-node
    // swarm needs to pull it); the local path keeps the image `--load`ed into
    // the swarm node's daemon. `imageDigest` is the content digest captured from
    // the push (`repo@sha256:…`), or null for the local path (no registry).
    const imageDigest = yield* await pushImageIfRegistry({
      registry: ctx.registry,
      image,
      sink,
    });

    yield* await step("image-ready", () => markImageReady(opts.deploymentId, image.shaTag));
    sink.system(`image-ready: ${image.shaTag} — updating swarm service`);

    // Capture the detected framework from the just-analysed work tree (local
    // files only — package.json + railpack's --info-out). Stored on the row so
    // the graph renders the brand logo without ever calling the git API. Never
    // throws: returns null if nothing was detected. Read before cleanup rm's
    // the clone dir.
    const framework = await detectServiceFramework({
      workDir: cloned.workDir,
      sourceSubdir: ctx.service.sourceSubdir,
      buildDir: image.buildDir,
      sink,
    });

    // Preview builds must NOT write the base serviceResource.image (it's shared
    // with production — writing it would repoint production at the preview's
    // image). They carry the built tag as a spec override instead. Base builds
    // update the row as before; `imageDigest` + `framework` describe THIS
    // build and are only persisted on the base row.
    const previewScope = await loadPreviewScope(ctx.deployment.previewId);
    const isPreview = previewScope != null;
    // The preview may have been torn down (idle reaper / manual / PR close)
    // while this build ran. Rolling now would recreate containers for a closed
    // preview with no routes — an orphan nothing reaps. Bail before the roll.
    if (isPreview && ctx.deployment.previewId) {
      const stillOpen = await isPreviewActive(ctx.deployment.previewId);
      if (!stillOpen) {
        return Result.err(
          new BuildStepError({
            step: "preview-closed",
            cause: new Error("preview was torn down during the build; skipping rollout"),
          }),
        );
      }
    }
    if (!isPreview) {
      yield* await step("set-image", () =>
        db
          .update(serviceResource)
          .set({ image: image.shaTag, imageDigest, framework })
          .where(eq(serviceResource.resourceId, ctx.resource.id as ResourceId)),
      );
    }

    yield* await runPreDeploy({
      ctx,
      image: image.shaTag,
      deploymentId: opts.deploymentId,
      sink,
    });

    const runtime = yield* (
      await redeployOne(
        ctx.project.id as ProjectId,
        ctx.resource.id as ResourceId,
        ctx.project.slug,
        undefined,
        {
          previewId: ctx.deployment.previewId ?? undefined,
          imageOverride: isPreview ? image.shaTag : undefined,
        },
      )
    ).mapError((cause) => new SwarmUpdateError(cause));
    sink.system(`swarm runtime: status=${runtime.status} health=${runtime.health ?? "n/a"}`);
    if (runtime.status !== "running") {
      return Result.err(
        new SwarmConvergenceError({
          serviceName: runtime.serviceName,
          health: runtime.health,
        }),
      );
    }

    yield* await step("mark-running", () => markRunning(opts.deploymentId));
    sink.system(`deployment running: ${image.shaTag}`);

    await runPostDeploy({
      ctx,
      image: image.shaTag,
      deploymentId: opts.deploymentId,
      sink,
    });
    return Result.ok(image.shaTag);
  });
}
