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
import { dockerLogin, dockerLogout, dockerPushTags, type PushCredentials } from "./docker-push";
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
 * buildDir, digest }` shape so the pipeline stays builder-agnostic: a repo
 * Dockerfile via `docker buildx build`, or railpack's BuildKit frontend.
 * `auto`/null resolves to dockerfile when one is present, else railpack.
 * `compose` resolves as railpack so the unsupported-builder fallback takes
 * effect. `push` (only takes effect alongside `cacheBuilder`) is threaded
 * through so the build can `--push` straight from the remote buildkitd
 * instead of `--load`ing locally — see `buildAndPublishImage`, the only
 * caller, which resolves whether pushing directly is possible.
 */
function runImageBuild(args: {
  buildConfig: BuildConfig | null;
  builder: Builder;
  workDir: string;
  sourceSubdir: string | null;
  imageRepository: string;
  gitSha: string;
  cacheBuilder: string | null;
  push: boolean;
  sink: LogSink;
}): Promise<{ shaTag: string; latestTag: string; buildDir: string; digest: string | null }> {
  const { buildConfig, builder, workDir, sourceSubdir, imageRepository, gitSha } = args;
  const { cacheBuilder, push, sink } = args;
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
      push,
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
    push,
    sink,
  });
}

export interface BuiltImage {
  shaTag: string;
  latestTag: string;
  buildDir: string;
  /** Content digest of the pushed image, or null for a local (no-registry)
   *  build — nothing was pushed. */
  imageDigest: string | null;
}

/**
 * Build the service image AND publish it, as one step — so a registry
 * `docker login` (needed either way, once a registry is bound) happens
 * exactly once, BEFORE the build, which is what lets a build that has both a
 * registry AND the remote buildkitd builder (see `buildx.ts`) skip the local
 * daemon entirely:
 *
 *   - registry + remote builder available → build with `--push`: the image
 *     goes straight from buildkitd to the registry. No `--load`, no separate
 *     `docker push`, no `docker inspect` — this build touches NO docker.sock
 *     at all (verified locally: the equivalent `buildx build --push` against
 *     a real registry succeeds with `DOCKER_HOST` pointed at a nonexistent
 *     socket). The digest comes back from buildx's `--metadata-file`.
 *   - registry, no remote builder → unchanged from before od-48w: `--load`
 *     into the local daemon, then `docker push` + `docker inspect` for the
 *     digest. This is the one remaining place a registry-bound build still
 *     needs docker.sock, and only when the remote builder itself is down.
 *   - no registry (the default local/single-node path) → `--load` only; the
 *     image must be present in the local daemon for the docker/swarm runtime
 *     to run it directly. No login, no push, no digest.
 *
 * `docker logout` always runs (in a `finally`, so it fires on a build
 * failure too) whenever a login happened, on either path.
 */
export function buildAndPublishImage(args: {
  buildConfig: BuildConfig | null;
  builder: Builder;
  workDir: string;
  sourceSubdir: string | null;
  imageRepository: string;
  gitSha: string;
  cacheBuilder: string | null;
  registry: typeof containerRegistry.$inferSelect | null;
  sink: LogSink;
}): Promise<Result<BuiltImage, BuildStepError>> {
  return Result.gen(async function* () {
    const { registry, sink } = args;
    let credentials: PushCredentials | null = null;
    if (registry) {
      const password = yield* await step("decrypt-registry", () =>
        decryptSecret(registry.encryptedPassword),
      );
      credentials = { host: registry.host, username: registry.username, password };
    }

    // Only skip `--load` when there's somewhere to push straight TO — no
    // registry still means the local docker/swarm runtime needs the image in
    // its own daemon, regardless of whether the remote builder is up.
    const pushDirect = args.cacheBuilder !== null && credentials !== null;

    if (credentials) {
      yield* await step("registry-login", () =>
        dockerLogin(credentials as PushCredentials, sink),
      );
    }

    try {
      const built = yield* await step("build", () =>
        runImageBuild({
          buildConfig: args.buildConfig,
          builder: args.builder,
          workDir: args.workDir,
          sourceSubdir: args.sourceSubdir,
          imageRepository: args.imageRepository,
          gitSha: args.gitSha,
          cacheBuilder: args.cacheBuilder,
          push: pushDirect,
          sink,
        }),
      );

      if (pushDirect) {
        sink.system(`pushed ${built.shaTag} directly from the remote buildkitd (no --load)`);
        return Result.ok({ ...built, imageDigest: built.digest });
      }
      if (credentials) {
        const creds = credentials;
        const pushed = yield* await step("push", () =>
          dockerPushTags({
            tags: [built.shaTag, built.latestTag],
            sink,
            secrets: [creds.password],
          }),
        );
        return Result.ok({ ...built, imageDigest: pushed.digest });
      }
      sink.system(`local build — skipping registry push for ${built.shaTag}`);
      return Result.ok({ ...built, imageDigest: null });
    } finally {
      if (credentials) await dockerLogout(credentials, sink).catch(() => undefined);
    }
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
