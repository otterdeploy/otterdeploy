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
 * deployments and must keep going if one fails.
 */

import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { OrganizationId } from "@otterdeploy/shared/id";
import type { RedisClient } from "bun";

import { getInstallationToken } from "@otterdeploy/api/git/github-app";
import { decryptSecret } from "@otterdeploy/api/lib/crypto";
import { emitPlatformEvent } from "@otterdeploy/api/notifications/emit";
import { redeployOne } from "@otterdeploy/api/routers/service/redeploy";
import { db } from "@otterdeploy/db";
import { deployment, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { log as globalLog } from "evlog";
import { rm } from "node:fs/promises";

import { pruneStaleBuildCache, pruneStaleBuilds } from "./build-workdir";
import { ensureBuildxBuilder, cachePathFor } from "./buildx";
import { cloneRepoAtSha } from "./clone";
import { isComposeDeployment, runComposeBuild } from "./compose-build";
import { runDeployHooks } from "./deploy-hook";
import { detectServiceFramework } from "./detect-framework";
import { dockerPush } from "./docker-push";
import { dockerfileBuild, resolveDockerfileBuild } from "./dockerfile";
import {
  BuildStepError,
  DeployHookError,
  InvalidDeploymentError,
  SwarmConvergenceError,
  SwarmUpdateError,
} from "./errors";
import { loadPipelineContext, PipelineLoadError } from "./load";
import { createLogSink, type LogSink } from "./log-stream";
import { railpackBuild } from "./railpack";
import { markBuilding, markFailed, markImageReady, markRunning } from "./state";

/** Every way the build sequence can fail, as a tagged union. */
type BuildPipelineError =
  | PipelineLoadError
  | BuildStepError
  | DeployHookError
  | InvalidDeploymentError
  | SwarmUpdateError
  | SwarmConvergenceError;

/** Mutable holder for the clone's work dir, so cleanup can remove it even
 *  when a later step fails (the dir is created mid-pipeline). */
interface WorkDirRef {
  path: string | null;
  /** True when `path` is under the data folder → a failed build's clone is kept
   *  for inspection rather than cleaned. */
  persistent: boolean;
}

/** Run a throwing infra step (clone, railpack, docker, DB) as a Result,
 *  tagging any throw with the step label instead of letting it propagate. */
function step<T>(label: string, fn: () => Promise<T>): Promise<Result<T, BuildStepError>> {
  return Result.tryPromise({
    try: fn,
    catch: (cause) => new BuildStepError({ step: label, cause }),
  });
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

    // Public-URL bindings carry no installationId — clone over anonymous
    // HTTPS. Installation-backed bindings mint a short-lived token + inject it.
    const installationId = ctx.repo.installationId;
    // A revoked GitHub App install soft-deletes by nulling installationId, which
    // would otherwise read as a public bind. A still-private repo with no
    // installation is exactly that case → treat it as github_app so the clone
    // failure surfaces "reconnect GitHub" rather than a generic git error.
    const bindingKind = installationId || ctx.repo.isPrivate ? "github_app" : "public_url";
    const imageRepository = ctx.imageRepository;
    let installationToken = "";
    if (installationId) {
      // A fully revoked/suspended install fails the token mint (GitHub won't
      // issue one) — reframe that to the same "reconnect GitHub" remedy the
      // clone step gives for a narrowed install, so both paths read the same.
      const minted = yield* (
        await step("token", () => getInstallationToken(installationId))
      ).mapError(
        (err) =>
          new BuildStepError({
            step: "token",
            // Use the underlying cause, not err.message — the latter already
            // carries the `build step "token" failed:` prefix step() added, so
            // reusing it would double the prefix.
            cause: new Error(
              `couldn't mint a GitHub token for this installation — it may have been removed or suspended; reconnect GitHub in Settings → Git (${
                err.cause instanceof Error ? err.cause.message : String(err.cause)
              })`,
            ),
          }),
      );
      installationToken = minted.token;
    }

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

    // Pick the builder. Two paths produce the same `{ shaTag, latestTag,
    // buildDir }` shape so everything below is builder-agnostic:
    //   - dockerfile: build the repo's Dockerfile via `docker buildx build
    //     --load` (resolved/path-checked by resolveDockerfileBuild).
    //   - railpack: analyse the repo, build through its BuildKit frontend, and
    //     `--load` the result into the host daemon (which, on a single-node
    //     swarm, is the same daemon the container runs in). Static sites get a
    //     Caddy image with optional SPA fallback.
    // `auto`/null resolves to dockerfile when a Dockerfile is present, else
    // railpack's zero-config detection. The railpack-shaped config only applies
    // when railpack is explicitly chosen. `compose` isn't supported yet — we
    // say so out loud and build with railpack rather than silently doing so.
    const buildConfig = ctx.service.buildConfig;
    const builder = buildConfig?.builder ?? "auto";
    if (builder === "compose") {
      sink.system("compose builds are not yet supported; falling back to railpack");
    }

    // Best-effort persistent layer cache: when a docker-container buildx builder
    // can be set up, route the build through it with a local cache keyed by the
    // image repo. Returns null (→ no cache, default-driver `--load`) on any
    // failure, so a build never depends on the cache being available.
    const cacheBuilder = await ensureBuildxBuilder(sink);
    const cachePath = cacheBuilder ? cachePathFor(imageRepository) : null;

    // Resolve inside the build step so any HARD throw (bad/missing Dockerfile
    // path when pinned to dockerfile) becomes a tagged BuildStepError.
    const image = yield* await step("build", () => {
      // `compose` has no dockerfile config; resolve it as railpack so the
      // fallback above takes effect.
      const resolveBuilder = builder === "compose" ? "railpack" : builder;
      const resolution = resolveDockerfileBuild({
        builder: resolveBuilder,
        dockerfilePath: buildConfig?.builder === "dockerfile" ? buildConfig.dockerfilePath : null,
        workDir: cloned.workDir,
        sourceSubdir: ctx.service.sourceSubdir,
      });
      for (const warning of resolution.warnings) sink.system(warning);

      if (resolution.kind === "dockerfile") {
        return dockerfileBuild({
          workDir: cloned.workDir,
          sourceSubdir: ctx.service.sourceSubdir,
          dockerfilePath: resolution.dockerfilePath,
          contextDir: resolution.contextDir,
          relativePath: resolution.relativePath,
          imageRepository,
          sha: gitSha,
          // Build-args only apply to the Dockerfile builder; an `auto` build
          // that resolves to a Dockerfile carries none (none configurable).
          buildArgs:
            buildConfig?.builder === "dockerfile"
              ? (buildConfig.buildArgs ?? undefined)
              : undefined,
          builderName: cacheBuilder,
          cachePath,
          sink,
        });
      }
      return railpackBuild({
        workDir: cloned.workDir,
        sourceSubdir: ctx.service.sourceSubdir,
        imageRepository,
        sha: gitSha,
        config: buildConfig?.builder === "railpack" ? buildConfig : null,
        builderName: cacheBuilder,
        cachePath,
        sink,
      });
    });

    // Push only when the project binds an external registry (remote or
    // multi-node swarm needs to pull it). The default path keeps the image
    // local — it's already `--load`ed into the swarm node's daemon.
    //
    // The registry push is also where we learn the image's content digest
    // (`repo@sha256:…`), captured for `serviceResource.imageDigest`. The
    // local path has no registry digest, so it stays null.
    const registry = ctx.registry;
    let imageDigest: string | null = null;
    if (registry) {
      const password = yield* await step("decrypt-registry", () =>
        decryptSecret(registry.encryptedPassword),
      );
      const pushed = yield* await step("push", () =>
        dockerPush({
          tags: [image.shaTag, image.latestTag],
          credentials: {
            host: registry.host,
            username: registry.username,
            password,
          },
          sink,
        }),
      );
      imageDigest = pushed.digest;
    } else {
      sink.system(`local build — skipping registry push for ${image.shaTag}`);
    }

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

    // Point the service resource at the new image so the spec assembled by
    // redeployOne carries the new tag. `imageDigest` is the content digest
    // captured from this build's registry push (`repo@sha256:…`), or null for
    // the local path (no registry, no digest) — it always describes THIS build,
    // never a stale prior one. `framework` rides along on the same write — also
    // a property of this build, captured above.
    yield* await step("set-image", () =>
      db
        .update(serviceResource)
        .set({ image: image.shaTag, imageDigest, framework })
        .where(eq(serviceResource.resourceId, ctx.resource.id as ResourceId)),
    );

    // Pre-deploy hooks run off the new image BEFORE the rollout — the slot for
    // db migrations. A non-zero exit short-circuits the flow (marks the row
    // failed) so the old replicas keep serving and the bad version never rolls.
    const preDeploy = ctx.service.preDeploy ?? [];
    if (preDeploy.length > 0) {
      yield* await runDeployHooks({
        phase: "pre-deploy",
        commands: preDeploy,
        image: image.shaTag,
        projectId: ctx.project.id as ProjectId,
        resourceId: ctx.resource.id as ResourceId,
        projectSlug: ctx.project.slug,
        deploymentId: opts.deploymentId,
        sink,
      });
    }

    const runtime = yield* (
      await redeployOne(
        ctx.project.id as ProjectId,
        ctx.resource.id as ResourceId,
        ctx.project.slug,
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

    // Post-deploy hooks run AFTER the new replicas are live + healthy (cache
    // warmup, smoke checks, deploy pings). The rollout already succeeded, so a
    // hook failure is surfaced loudly but does NOT flip a live, healthy
    // deployment to "failed" — that status would contradict reality.
    const postDeploy = ctx.service.postDeploy ?? [];
    if (postDeploy.length > 0) {
      const hooked = await runDeployHooks({
        phase: "post-deploy",
        commands: postDeploy,
        image: image.shaTag,
        projectId: ctx.project.id as ProjectId,
        resourceId: ctx.resource.id as ResourceId,
        projectSlug: ctx.project.slug,
        deploymentId: opts.deploymentId,
        sink,
      });
      if (hooked.isErr()) {
        sink.system(`post-deploy hook failed (deployment stays live): ${hooked.error.message}`);
      }
    }
    return Result.ok(image.shaTag);
  });
}

/** Mark the deployment row failed + emit logs for a build failure. Never
 *  throws — a failed `markFailed` is logged, not surfaced. The caller derives
 *  the surfaced message from the Result's error channel. */
async function handleFailure(
  deploymentId: DeploymentId,
  sink: LogSink,
  err: BuildPipelineError,
): Promise<void> {
  const message = err.message;
  sink.system(`build failed: ${message}`);
  await markFailed(deploymentId, message).catch((stateErr) => {
    globalLog.error({
      build: { event: "mark-failed-failed", deploymentId },
      error: stateErr instanceof Error ? stateErr.message : String(stateErr),
    } as Record<string, unknown>);
  });
  // Best-effort: fan a `build.failed` event out to subscribed channels — the
  // only failure notification the builder produces (the row is marked failed
  // here, not via the API's deploy.failed path). Never blocks the failure flow.
  await emitBuildFailed(deploymentId, message).catch(() => undefined);
  if (err instanceof PipelineLoadError) {
    globalLog.warn({
      build: {
        event: "load-failed",
        deploymentId,
        step: err.step,
      },
      error: message,
    } as Record<string, unknown>);
  }
}

/**
 * Emit a `build.failed` platform event for a failed deployment. Resolves the
 * org + display names from the deployment's resource/project; best-effort, so a
 * missing row (e.g. the resource was deleted mid-build) or a notification
 * problem is swallowed by the caller's `.catch`.
 */
async function emitBuildFailed(deploymentId: DeploymentId, message: string): Promise<void> {
  const [ctx] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  if (!ctx) return;
  await emitPlatformEvent({
    organizationId: ctx.organizationId as OrganizationId,
    eventId: "build.failed",
    title: "Build failed",
    message: `${ctx.resourceName}: ${message}`.slice(0, 500),
    data: {
      deploymentId,
      resource: ctx.resourceName,
      project: ctx.projectName,
    },
  });
}
