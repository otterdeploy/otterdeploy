/**
 * Orchestration layer for the Service primitive. Stitches together the
 * queries module, the Swarm provisioner, the variable resolver, and the
 * Caddy reconciler.
 *
 * Returns `Result<View, TaggedError>` so the oRPC handler layer can switch
 * on `result.error._tag` to translate to the right wire-level error code.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { resolveRuntimeScopesForProject } from "../../lib/environment/runtime-scope";
import { runtimeServiceName } from "../../lib/environment/scoping";
import { runtime } from "../../runtime";
import { removeServiceFromManifest } from "../project/manifest";
import { loadProject, loadResource } from "./context";
import { ServiceInUseError, ServiceNotFoundError, type ResolveError } from "./errors";
import { getService } from "./get-service";
import {
  type ProjectRef,
  type ResourceRef,
  type RolloutTiming,
  type UpdateServiceInput,
  toUpdateRecordPatch,
} from "./inputs";
import {
  deleteServiceRecord,
  findExternalDependents,
  listServiceRecordsByProject,
  replaceServicePorts,
  updateServiceRecord,
} from "./queries";
import { redeployDependents } from "./redeploy";
import { checkRolloutResolvable, startRollout } from "./rollout";
import { serviceRuntimeName } from "./runtime-name";
import { reclaimServiceHostArtifacts } from "./teardown";
import {
  mapEnvVar,
  mapServiceView,
  normalizePorts,
  sanitizeSlug,
  type EnvVarView,
  type ServiceMutationView,
  type ServiceView,
} from "./views";

export type { EnvVarView, ServiceMutationView, ServiceView } from "./views";
// `CreateServiceInput` is deliberately NOT re-exported here: `createService`
// moved to ./create.ts, so this module is no longer where callers reach it.
export type { RolloutTiming, UpdateServiceInput } from "./inputs";

export { exposeService, unexposeService } from "./expose";
export { bulkSetEnv, setEnv, syncManifestEnvAfterLiveEdit, unsetEnv } from "./env-handlers";
// Lives in a leaf so `expose.ts` can read it without importing this file; see
// get-service.ts for why that edge mattered.
export { createService } from "./create";
export { getService } from "./get-service";
export { rollbackService } from "./rollback";

// Common error shapes: keep handler signatures legible.
type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

export async function listServices(
  input: ProjectRef,
): Promise<Result<ServiceView[], ProjectNotFoundError>> {
  const project = await loadProject(input);
  if (project.isErr()) return Result.err(project.error);

  const records = await listServiceRecordsByProject(input.projectId);
  // Resolve every service's live runtime in ONE runtime round-trip, then hand
  // each pre-resolved status to mapServiceView: instead of mapServiceView
  // opening a fresh Docker connection + lookup per service (the list N+1).
  // Looked up by RUNTIME name: a staging service runs as `<base>-staging`, and
  // reading the base name reported production's container as staging's.
  const projectSlug = sanitizeSlug(project.value.slug);
  const scopeOf = await resolveRuntimeScopesForProject(input.projectId);
  const runtimeNames = records.map((r) =>
    runtimeServiceName(r.service.serviceName, scopeOf(r.resource.environmentId)),
  );
  const runtimes = await runtime().inspectMany(
    runtimeNames.map((serviceName) => ({ serviceName, projectSlug })),
  );
  const views = await Promise.all(
    records.map((r, i) => {
      const name = runtimeNames[i];
      return mapServiceView(r, project.value.slug, name ? runtimes.get(name) : undefined);
    }),
  );
  return Result.ok(views);
}

export async function listEnv(input: ResourceRef): Promise<Result<EnvVarView[], NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  return Result.ok(ctx.value.record.env.map(mapEnvVar));
}

export async function updateService(
  input: UpdateServiceInput,
  log: RequestLogger,
  rollout: RolloutTiming = "now",
): Promise<Result<ServiceMutationView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  await updateServiceRecord(input.resourceId, toUpdateRecordPatch(input));

  if (input.ports) {
    await replaceServicePorts(input.resourceId, normalizePorts(input.ports));
  }

  if (rollout === "with-build") {
    const redeployed = await redeployDependents(
      input.projectId,
      input.resourceId,
      ctx.value.project.slug,
      log,
    );
    if (redeployed.isErr()) return Result.err(redeployed.error);
    return withDeployment(await getService(input), null);
  }

  const imageChanged = input.image !== undefined && input.image !== ctx.value.record.service.image;
  const started = await rollInBackground(input, imageChanged ? "image-change" : "redeploy", log);
  if (started.isErr()) return Result.err(started.error);
  return withDeployment(await getService(input), started.value);
}

/** The roll a write asks for, off the request (./rollout.ts): refuses an env
 *  that cannot resolve, else records the deployment and returns its id. */
export async function rollInBackground(
  input: ResourceRef,
  reason: "redeploy" | "image-change" | "restart" | "env-change",
  log: RequestLogger,
): Promise<Result<DeploymentId, RedeployFailure>> {
  const resolvable = await checkRolloutResolvable(input.projectId, input.resourceId);
  if (resolvable.isErr()) return Result.err(resolvable.error);
  // Read after the write: the row records the image this roll puts in place.
  const loaded = await loadResource(input);
  if (loaded.isErr()) return Result.err(loaded.error);
  const { record } = loaded.value;
  const deploymentId = await startRollout({
    kind: "roll",
    projectId: input.projectId,
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    reason,
    image: record.service.image,
    snapshot: { image: record.service.image, source: record.service.source },
    fanOut: true,
    log,
  });
  return Result.ok(deploymentId);
}

function withDeployment<E>(
  view: Result<ServiceView, E>,
  deploymentId: DeploymentId | null,
): Result<ServiceMutationView, E> {
  return view.map((v) => ({ ...v, deploymentId }));
}

export async function deleteService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<{ ok: true }, NotFound | ServiceInUseError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record } = ctx.value;

  // Stack-aware: a child is also referenced by compose key
  // (`${{stack.db.HOST}}`), which a name-only scan misses — deleting it would
  // break a sibling silently instead of reporting it in use.
  const externalDependents = await findExternalDependents({
    projectId: input.projectId,
    resourceId: input.resourceId,
    resourceName: record.resource.name,
  });
  if (externalDependents.length > 0) {
    return Result.err(
      new ServiceInUseError({
        resourceId: input.resourceId,
        referrers: externalDependents,
      }),
    );
  }

  // What this resource actually runs as. The stored name is the base one that
  // production shares, so destroying by it from a staging delete would take
  // down production's container and leave staging's running.
  // Resolved before anything is written, so a failure here changes nothing.
  const runtimeName = await serviceRuntimeName(record);

  // Strip it from the manifest FIRST: before any physical teardown. Once a
  // delete is initiated the service is no longer "desired", so even if teardown
  // fails partway the next diff can only ever show a (recoverable) delete -
  // NEVER a phantom `create` ghost. A deployed service must never revert to
  // pending-create.
  await removeServiceFromManifest(
    { projectId: input.projectId, organizationId: input.organizationId },
    record.resource.name,
  );

  await deleteProxyRoutesByResource(input.resourceId);
  // Stop + remove the running container / swarm service. If the daemon is
  // unreachable this used to throw and block the whole delete, stranding the
  // user with an undeletable service. The DB row is the source of truth and is
  // removed regardless (see reclaimServiceHostArtifacts' contract), so instead
  // record the leaked object as an orphan and let the GC sweep retry teardown
  // (system-health/orphan-gc.ts).
  await runtime()
    .destroy({ serviceName: runtimeName }, log)
    .catch(async (cause) => {
      const { recordOrphanedResource } = await import("../../system-health/orphan-gc");
      await recordOrphanedResource({
        organizationId: input.organizationId,
        resourceType: "service",
        ref: runtimeName,
        projectId: input.projectId,
        label: `service teardown failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        // environmentId (null = main env) lets a GC retry rebuild the
        // resource's env-keyed on-disk ref.
        payload: {
          projectId: input.projectId,
          resourceId: input.resourceId,
          environmentId: record.resource.environmentId ?? null,
        },
      });
    });
  // Reclaim host artifacts (built images, buildx cache, volumes): the container
  // teardown above only removes the running container. The host ref is
  // environment-keyed (null = main env).
  // By runtime name too: the builder keys its local image repo on the BASE
  // name, which production shares, so a staging delete must not force-remove
  // those images out from under production's running container.
  const hostRef = { ...input, environmentId: record.resource.environmentId ?? null };
  await reclaimServiceHostArtifacts(runtimeName, hostRef, log);
  await deleteServiceRecord(input.resourceId);
  await reconcile(log);

  log.set({ teardown: { service: runtimeName, ok: true } });

  return Result.ok({ ok: true });
}

export async function restartService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceMutationView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  // The roll bumps ForceUpdate unconditionally, so a restart with no spec
  // change still replaces the container. Off the request, like an update.
  const started = await rollInBackground(input, "restart", log);
  if (started.isErr()) return Result.err(started.error);
  return withDeployment(await getService(input), started.value);
}
