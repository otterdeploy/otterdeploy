/**
 * Orchestration layer for the Service primitive. Stitches together the
 * queries module, the Swarm provisioner, the variable resolver, and the
 * Caddy reconciler.
 *
 * Returns `Result<View, TaggedError>` so the oRPC handler layer can switch
 * on `result.error._tag` to translate to the right wire-level error code.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { runtime } from "../../runtime";
import { removeServiceFromManifest } from "../project/manifest";
import { loadProject, loadResource } from "./context";
import { ServiceInUseError, ServiceNotFoundError, type ResolveError } from "./errors";
import { getService } from "./get-service";
import {
  type ProjectRef,
  type ResourceRef,
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
import { redeployAndFanOut } from "./redeploy";
import { reclaimServiceHostArtifacts } from "./teardown";
import {
  mapEnvVar,
  mapServiceView,
  normalizePorts,
  sanitizeSlug,
  type EnvVarView,
  type ServiceView,
} from "./views";

export type { EnvVarView, ServiceView } from "./views";
export type { CreateServiceInput, UpdateServiceInput } from "./inputs";

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
  const projectSlug = sanitizeSlug(project.value.slug);
  const runtimes = await runtime().inspectMany(
    records.map((r) => ({ serviceName: r.service.serviceName, projectSlug })),
  );
  const views = await Promise.all(
    records.map((r) => mapServiceView(r, project.value.slug, runtimes.get(r.service.serviceName))),
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
): Promise<Result<ServiceView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  await updateServiceRecord(input.resourceId, toUpdateRecordPatch(input));

  if (input.ports) {
    await replaceServicePorts(input.resourceId, normalizePorts(input.ports));
  }

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return getService(input);
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
    .destroy({ serviceName: record.service.serviceName }, log)
    .catch(async (cause) => {
      const { recordOrphanedResource } = await import("../../system-health/orphan-gc");
      await recordOrphanedResource({
        organizationId: input.organizationId,
        resourceType: "service",
        ref: record.service.serviceName,
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
  const hostRef = { ...input, environmentId: record.resource.environmentId ?? null };
  await reclaimServiceHostArtifacts(record.service.serviceName, hostRef, log);
  await deleteServiceRecord(input.resourceId);
  await reconcile(log);

  log.set({ teardown: { service: record.service.serviceName, ok: true } });

  return Result.ok({ ok: true });
}

export async function restartService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  // redeployOne now bumps ForceUpdate unconditionally: no explicit bump
  // needed here.
  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return getService(input);
}
