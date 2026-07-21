/**
 * Step helpers for the build pipeline (`pipeline.ts`).
 *
 * Each export is a cohesive slice of the build sequence — token minting, image
 * build, registry push, deploy hooks — plus the shared `step()` wrapper, the
 * tagged-error union, and the failure handler. They live here so the pipeline's
 * `Result.gen` flow reads as a short, linear list of `yield*`ed steps. Every
 * helper preserves the exact behavior it had inline.
 */

import type { Builder, BuildConfig } from "@otterdeploy/shared/build-config";
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { getInstallationToken } from "@otterdeploy/api/git/github-app";
import { decryptSecret } from "@otterdeploy/api/lib/crypto";
import { emitPlatformEvent } from "@otterdeploy/api/notifications/emit";
import { db } from "@otterdeploy/db";
import { containerRegistry, deployment, project, resource } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { log as globalLog } from "evlog";

import type { PipelineContext } from "./load";
import type { LogSink } from "./log-stream";

import { readFileSync } from "node:fs";

import { runDeployHooks } from "./deploy-hook";
import { dockerPush } from "./docker-push";
import { dockerfileBuild, resolveDockerfileBuild } from "./dockerfile";
import { assertDockerfileValid } from "./dockerfile-validate";
import {
  BuildStepError,
  DeployHookError,
  InvalidDeploymentError,
  SwarmConvergenceError,
  SwarmUpdateError,
} from "./errors";
import { PipelineLoadError } from "./load";
import { railpackBuild } from "./railpack";
import { markFailed } from "./state";

/** Every way the build sequence can fail, as a tagged union. */
export type BuildPipelineError =
  | PipelineLoadError
  | BuildStepError
  | DeployHookError
  | InvalidDeploymentError
  | SwarmUpdateError
  | SwarmConvergenceError;

/** Run a throwing infra step (clone, railpack, docker, DB) as a Result,
 *  tagging any throw with the step label instead of letting it propagate. */
export function step<T>(label: string, fn: () => Promise<T>): Promise<Result<T, BuildStepError>> {
  return Result.tryPromise({
    try: fn,
    catch: (cause) => new BuildStepError({ step: label, cause }),
  });
}

/** Resolve how the repo is bound. A revoked GitHub App install soft-deletes by
 *  nulling installationId; a still-private repo with no install is exactly that
 *  case → treat it as github_app so the clone failure surfaces "reconnect
 *  GitHub" rather than a generic git error. */
export function resolveBindingKind(
  installationId: string | null,
  isPrivate: boolean,
): "github_app" | "public_url" {
  return installationId || isPrivate ? "github_app" : "public_url";
}

/** Pick the builder from the service's build config. `compose` isn't supported
 *  yet — we say so out loud and fall back to railpack rather than silently. */
export function resolveBuilder(buildConfig: BuildConfig | null, sink: LogSink): Builder {
  const builder = buildConfig?.builder ?? "auto";
  if (builder === "compose") {
    sink.system("compose builds are not yet supported; falling back to railpack");
  }
  return builder;
}

/** Mint a short-lived installation token, or "" when the bind carries no
 *  installation (public clone). A fully revoked/suspended install fails the
 *  mint — reframe that to the same "reconnect GitHub" remedy the clone step
 *  gives, so both paths read the same. */
export async function mintInstallationToken(
  installationId: string | null,
): Promise<Result<string, BuildStepError>> {
  if (!installationId) return Result.ok("");
  const minted = await step("token", () => getInstallationToken(installationId));
  return minted
    .mapError(
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
    )
    .map((m) => m.token);
}

/**
 * Build the service image. Two paths produce the same `{ shaTag, latestTag,
 * buildDir }` shape so the pipeline stays builder-agnostic: a repo Dockerfile
 * via `docker buildx build --load`, or railpack's BuildKit frontend. `auto`/
 * null resolves to dockerfile when one is present, else railpack. `compose`
 * resolves as railpack so the unsupported-builder fallback takes effect.
 */
export function runImageBuild(args: {
  buildConfig: BuildConfig | null;
  builder: Builder;
  workDir: string;
  sourceSubdir: string | null;
  imageRepository: string;
  gitSha: string;
  cacheBuilder: string | null;
  cachePath: string | null;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string }> {
  const { buildConfig, builder, workDir, sourceSubdir, imageRepository, gitSha } = args;
  const { cacheBuilder, cachePath, sink } = args;
  // `compose` has no dockerfile config; resolve it as railpack.
  const resolveBuilderKind = builder === "compose" ? "railpack" : builder;
  const resolution = resolveDockerfileBuild({
    builder: resolveBuilderKind,
    dockerfilePath: buildConfig?.builder === "dockerfile" ? buildConfig.dockerfilePath : null,
    workDir,
    sourceSubdir,
  });
  for (const warning of resolution.warnings) sink.system(warning);

  if (resolution.kind === "dockerfile") {
    // Fail fast on unsupported instructions BEFORE invoking docker — a clear
    // `file:line + reason + fix` beats a silent-wrong build (the VOLUME case).
    assertDockerfileValid(readFileSync(resolution.dockerfilePath, "utf8"), (m) => sink.system(m));
    return dockerfileBuild({
      workDir,
      sourceSubdir,
      dockerfilePath: resolution.dockerfilePath,
      contextDir: resolution.contextDir,
      relativePath: resolution.relativePath,
      imageRepository,
      sha: gitSha,
      // Build-args only apply to the Dockerfile builder; an `auto` build that
      // resolves to a Dockerfile carries none (none configurable).
      buildArgs:
        buildConfig?.builder === "dockerfile" ? (buildConfig.buildArgs ?? undefined) : undefined,
      builderName: cacheBuilder,
      cachePath,
      sink,
    });
  }
  return railpackBuild({
    workDir,
    sourceSubdir,
    imageRepository,
    sha: gitSha,
    config: buildConfig?.builder === "railpack" ? buildConfig : null,
    builderName: cacheBuilder,
    cachePath,
    sink,
  });
}

/**
 * Push the built image when the project binds an external registry (remote or
 * multi-node swarm needs to pull it); the default path keeps the image local.
 * Returns the pushed content digest (`repo@sha256:…`) — or null when there's no
 * registry (the local path has none).
 */
export function pushImageIfRegistry(args: {
  registry: typeof containerRegistry.$inferSelect | null;
  image: { shaTag: string; latestTag: string };
  sink: LogSink;
}): Promise<Result<string | null, BuildStepError>> {
  return Result.gen(async function* () {
    const { registry, image, sink } = args;
    if (!registry) {
      sink.system(`local build — skipping registry push for ${image.shaTag}`);
      return Result.ok(null);
    }
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
    return Result.ok(pushed.digest);
  });
}

/** Pre-deploy hooks run off the new image BEFORE the rollout — the slot for db
 *  migrations. A non-zero exit short-circuits the flow so the old replicas keep
 *  serving and the bad version never rolls. No-op when none are configured. */
export function runPreDeploy(args: {
  ctx: PipelineContext;
  image: string;
  deploymentId: DeploymentId;
  sink: LogSink;
}): Promise<Result<void, DeployHookError>> {
  const { ctx, image, deploymentId, sink } = args;
  const commands = ctx.service.preDeploy ?? [];
  if (commands.length === 0) return Promise.resolve(Result.ok(undefined));
  return runDeployHooks({
    phase: "pre-deploy",
    commands,
    image,
    projectId: ctx.project.id as ProjectId,
    resourceId: ctx.resource.id as ResourceId,
    projectSlug: ctx.project.slug,
    // Preview builds resolve hook env (migrations!) against the preview's
    // branch DBs, byte-identical to the container's own resolution.
    previewId: ctx.deployment.previewId ?? null,
    deploymentId,
    sink,
  });
}

/** Post-deploy hooks run AFTER the new replicas are live + healthy. The rollout
 *  already succeeded, so a hook failure is surfaced loudly but does NOT flip a
 *  live, healthy deployment to "failed" — that would contradict reality. */
export async function runPostDeploy(args: {
  ctx: PipelineContext;
  image: string;
  deploymentId: DeploymentId;
  sink: LogSink;
}): Promise<void> {
  const { ctx, image, deploymentId, sink } = args;
  const commands = ctx.service.postDeploy ?? [];
  if (commands.length === 0) return;
  const hooked = await runDeployHooks({
    phase: "post-deploy",
    commands,
    image,
    previewId: ctx.deployment.previewId ?? null,
    projectId: ctx.project.id as ProjectId,
    resourceId: ctx.resource.id as ResourceId,
    projectSlug: ctx.project.slug,
    deploymentId,
    sink,
  });
  if (hooked.isErr()) {
    sink.system(`post-deploy hook failed (deployment stays live): ${hooked.error.message}`);
  }
}

/** Mark the deployment row failed + emit logs for a build failure. Never
 *  throws — a failed `markFailed` is logged, not surfaced. The caller derives
 *  the surfaced message from the Result's error channel. */
export async function handleFailure(
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
