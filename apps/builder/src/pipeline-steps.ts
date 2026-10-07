/**
 * Step helpers for the build pipeline (`pipeline.ts`).
 *
 * Each export is a cohesive slice of the build sequence. Token minting, image
 * build, registry push, deploy hooks. Plus the shared `step()` wrapper, the
 * tagged-error union, and the failure handler. They live here so the pipeline's
 * `Result.gen` flow reads as a short, linear list of `yield*`ed steps. Every
 * helper preserves the exact behavior it had inline.
 */

import type { SwarmServiceRuntime } from "@otterdeploy/api/swarm";
import type { Builder, BuildConfig } from "@otterdeploy/shared/build-config";
import type { DeploymentId } from "@otterdeploy/shared/id";

import { getInstallationToken } from "@otterdeploy/api/git/github-app";
import { emitPlatformEvent } from "@otterdeploy/api/notifications/emit";
import { db } from "@otterdeploy/db";
import { deployment, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { log as globalLog } from "evlog";

import type { PipelineContext } from "./load";
import type { LogSink } from "./log-stream";

import { runDeployHooks } from "./deploy-hook";
import { dockerPush } from "./docker-push";
import {
  BuildStepError,
  DeployHookError,
  DeploymentSupersededError,
  InvalidDeploymentError,
  SwarmConvergenceError,
  SwarmUpdateError,
} from "./errors";
import { PipelineLoadError } from "./load";
import { type RegistryCredentialSource, resolvePushCredentials } from "./registry-credential";
import { markFailed } from "./state";

/** Every way the build sequence can fail, as a tagged union. */
export type BuildPipelineError =
  | PipelineLoadError
  | BuildStepError
  | DeployHookError
  | DeploymentSupersededError
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

/** Run one of the guarded state writes (markBuilding / markRunning) as a
 *  step. A write the row refused (it left pending/building: cancelled, failed
 *  by the reconcile, settled elsewhere) ends the build as superseded rather
 *  than as a failure. */
export async function transitionStep(
  label: "mark-building" | "mark-running",
  deploymentId: DeploymentId,
  mark: (id: DeploymentId) => Promise<boolean>,
): Promise<Result<void, BuildStepError | DeploymentSupersededError>> {
  const acted = await step(label, () => mark(deploymentId));
  if (acted.isErr()) return Result.err(acted.error);
  if (!acted.value) return Result.err(new DeploymentSupersededError({ deploymentId, step: label }));
  return Result.ok(undefined);
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
 *  yet: we say so out loud and fall back to railpack rather than silently. */
export function resolveBuilder(buildConfig: BuildConfig | null, sink: LogSink): Builder {
  const builder = buildConfig?.builder ?? "auto";
  if (builder === "compose") {
    sink.system("compose builds are not yet supported; falling back to railpack");
  }
  return builder;
}

/** Mint a short-lived installation token, or "" when the bind carries no
 *  installation (public clone). A fully revoked/suspended install fails the
 *  mint: reframe that to the same "reconnect GitHub" remedy the clone step
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
          // Use the underlying cause, not err.message. The latter already
          // carries the `build step "token" failed:` prefix step() added, so
          // reusing it would double the prefix.
          cause: new Error(
            `couldn't mint a GitHub token for this installation. It may have been removed or suspended; reconnect GitHub in Settings → Git (${
              err.cause instanceof Error ? err.cause.message : String(err.cause)
            })`,
          ),
        }),
    )
    .map((m) => m.token);
}

/**
 * Push the built image when the project binds an external registry (remote or
 * multi-node swarm needs to pull it); the default path keeps the image local.
 * Returns the pushed content digest (`repo@sha256:…`), or null when there's no
 * registry (the local path has none).
 */
export function pushImageIfRegistry(args: {
  registry: RegistryCredentialSource | null;
  image: { shaTag: string; latestTag: string };
  sink: LogSink;
}): Promise<Result<string | null, BuildStepError>> {
  return Result.gen(async function* () {
    const { registry, image, sink } = args;
    if (!registry) {
      sink.system(`local build; skipping registry push for ${image.shaTag}`);
      return Result.ok(null);
    }
    // Resolved HERE, immediately before the push, never at load or enqueue: a
    // GitHub-App-derived GHCR token expires in about an hour and this build
    // may have queued or taken longer. See ./registry-credential.ts.
    const credentials = yield* await step("resolve-registry", () =>
      resolvePushCredentials(registry),
    );
    const pushed = yield* await step("push", () =>
      dockerPush({ tags: [image.shaTag, image.latestTag], credentials, sink }),
    );
    return Result.ok(pushed.digest);
  });
}

/** Pre-deploy hooks run off the new image BEFORE the rollout. The slot for db
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
    projectId: ctx.project.id,
    resourceId: ctx.resource.id,
    projectSlug: ctx.project.slug,
    // Preview builds resolve hook env (migrations!) against the preview's
    // branch DBs, byte-identical to the container's own resolution.
    previewId: ctx.deployment.previewId ?? null,
    deploymentId,
    sink,
  });
}

/** Post-deploy hooks run AFTER the new task reaches `running`. The rollout
 *  already succeeded, so a hook failure is surfaced loudly but does NOT flip a
 *  live deployment to "failed". That would contradict reality. */
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
    projectId: ctx.project.id,
    resourceId: ctx.resource.id,
    projectSlug: ctx.project.slug,
    deploymentId,
    sink,
  });
  if (hooked.isErr()) {
    sink.system(`post-deploy hook failed (deployment stays live): ${hooked.error.message}`);
  }
}

/**
 * A rollout the runtime rolled back: the previous version keeps serving, so
 * the service row goes back to that version's image (and digest). Best-effort:
 * a failed write is logged, never a second failure on top of the first.
 */
/** The slice of the pipeline context a rollout verdict reads: the resource it
 *  rolled, and the service row as it was BEFORE this build repointed it. */
export interface RolloutSubject {
  resource: Pick<PipelineContext["resource"], "id">;
  service: Pick<PipelineContext["service"], "image" | "imageDigest">;
}

async function restorePreviousImage(
  ctx: RolloutSubject,
  sink: Pick<LogSink, "system">,
): Promise<void> {
  const restored = await Result.tryPromise({
    try: () =>
      db
        .update(serviceResource)
        .set({ image: ctx.service.image, imageDigest: ctx.service.imageDigest })
        .where(eq(serviceResource.resourceId, ctx.resource.id)),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  sink.system(
    restored.isOk()
      ? `kept the previous version (${ctx.service.image}) as the service's image`
      : `could not restore the previous image on the service row: ${restored.error}`,
  );
}

/**
 * The rollout's verdict. Anything but `running` fails the deployment with the
 * runtime's own reason (the readiness gate's "nothing accepted a connection on
 * port 3000", not "convergence failed"). When the runtime kept the previous
 * version, the service row is pointed back at its image too, or the next
 * restart / env change would redeploy the version that just failed
 *. Preview rolls never wrote the base row, so never restore it.
 */
export async function checkRollout(
  ctx: RolloutSubject,
  runtime: SwarmServiceRuntime,
  isPreview: boolean,
  sink: Pick<LogSink, "system">,
): Promise<Result<void, SwarmConvergenceError>> {
  if (runtime.status === "running") return Result.ok(undefined);
  if (runtime.rolledBack && !isPreview) await restorePreviousImage(ctx, sink);
  return Result.err(
    new SwarmConvergenceError({
      serviceName: runtime.serviceName,
      health: runtime.health,
      reason: runtime.errorMessage,
    }),
  );
}

/** Mark the deployment row failed + emit logs for a build failure. Never
 *  throws: a failed `markFailed` is logged, not surfaced. The caller derives
 *  the surfaced message from the Result's error channel. */
export async function handleFailure(
  deploymentId: DeploymentId,
  sink: LogSink,
  err: BuildPipelineError,
): Promise<void> {
  const message = err.message;
  if (err instanceof DeploymentSupersededError) {
    // Cancelled (or settled) out from under the build: the row is already
    // terminal, so there is nothing to mark and no failure to announce.
    sink.system(`build stopped: ${message}`);
    return;
  }
  sink.system(`build failed: ${message}`);
  await markFailed(deploymentId, message).catch((stateErr) => {
    globalLog.error({
      build: { event: "mark-failed-failed", deploymentId },
      error: stateErr instanceof Error ? stateErr.message : String(stateErr),
    });
  });
  // Best-effort: fan a `build.failed` event out to subscribed channels. The
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
    });
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
      resourceId: deployment.resourceId,
      resourceName: resource.name,
      projectName: project.name,
      projectSlug: project.slug,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  if (!ctx) return;
  await emitPlatformEvent({
    // Plain string off the select (project.organizationId isn't a branded
    // column): branded via the boundary validator, same as caddy/certs.ts.
    organizationId: idSchema.organization.parse(ctx.organizationId),
    eventId: "build.failed",
    title: "Build failed",
    message: `${ctx.resourceName}: ${message}`.slice(0, 500),
    subject: {
      kind: "service",
      id: ctx.resourceId,
      label: ctx.resourceName,
      project: ctx.projectSlug,
    },
    data: {
      deploymentId,
      resource: ctx.resourceName,
      project: ctx.projectName,
    },
  });
}
