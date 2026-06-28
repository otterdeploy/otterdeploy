/**
 * Orchestration layer for the Service primitive. Stitches together the
 * queries module, the Swarm provisioner, the variable resolver, and the
 * Caddy reconciler.
 *
 * Returns `Result<View, TaggedError>` so the oRPC handler layer can switch
 * on `result.error._tag` to translate to the right wire-level error code.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { runtime } from "../../runtime";
import { loadProject, loadResource } from "./context";
import {
  MissingProjectBuildBindingError,
  ServiceConflictError,
  ServiceInUseError,
  ServiceNotFoundError,
  type ResolveError,
} from "./errors";
import {
  type CreateServiceInput,
  type ProjectRef,
  type ResourceRef,
  type UpdateServiceInput,
  toCreateRecordPayload,
  toUpdateRecordPatch,
} from "./inputs";
import {
  createServiceRecord,
  deleteServiceRecord,
  findServiceDependentsByName,
  getServiceRecord,
  getServiceRecordByName,
  listServiceRecordsByProject,
  replaceServicePorts,
  updateServiceRecord,
  type ServiceRecord,
} from "./queries";
import { provisionFresh, redeployAndFanOut } from "./redeploy";
import {
  isUniqueViolation,
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
export { bulkSetEnv, setEnv, unsetEnv } from "./env-handlers";
export { rollbackService } from "./rollback";

// Common error shapes — keep handler signatures legible.
type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

export async function listServices(
  input: ProjectRef,
): Promise<Result<ServiceView[], ProjectNotFoundError>> {
  const project = await loadProject(input);
  if (project.isErr()) return Result.err(project.error);

  const records = await listServiceRecordsByProject(input.projectId);
  const views = await Promise.all(records.map((r) => mapServiceView(r, project.value.slug)));
  return Result.ok(views);
}

export async function getService(input: ResourceRef): Promise<Result<ServiceView, NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  return Result.ok(await mapServiceView(ctx.value.record, ctx.value.project.slug));
}

export async function listEnv(input: ResourceRef): Promise<Result<EnvVarView[], NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  return Result.ok(ctx.value.record.env.map(mapEnvVar));
}

export async function createService(
  input: CreateServiceInput,
  log: RequestLogger,
): Promise<
  Result<
    ServiceView,
    ProjectNotFoundError | ServiceConflictError | MissingProjectBuildBindingError | ResolveError
  >
> {
  log.set({
    resource: { kind: "service", projectId: input.projectId, name: input.name },
  });

  const projectResult = await loadProject(input);
  if (projectResult.isErr()) return Result.err(projectResult.error);
  const project = projectResult.value;

  const existing = await getServiceRecordByName(input.projectId, input.name);
  if (existing) {
    return Result.err(new ServiceConflictError({ name: input.name }));
  }

  const source = input.source ?? "image";

  // Git-sourced services can't exist without a project-level binding —
  // the build worker reads gitRepoId / containerRegistryId / imageRepository
  // off the project at build time. Fail fast with a typed error the UI
  // can use to redirect the operator to Settings.
  if (source === "git" && !input.skipBuildBindingCheck) {
    const missing: Array<"gitRepoId" | "containerRegistryId" | "imageRepository"> = [];
    if (!project.gitRepoId) missing.push("gitRepoId");
    if (!project.containerRegistryId) missing.push("containerRegistryId");
    if (!project.imageRepository) missing.push("imageRepository");
    if (missing.length > 0) {
      return Result.err(new MissingProjectBuildBindingError({ missing }));
    }
  }

  const projectSlug = sanitizeSlug(project.slug);
  const resourceSlug = sanitizeSlug(input.name);
  const serviceName = `${PLATFORM.service.serviceNamePrefix}${projectSlug}-${resourceSlug}`.slice(
    0,
    63,
  );
  const networkName = `${PLATFORM.swarm.networkPrefix}${projectSlug}`;
  const internalHostname = resourceSlug;

  const ports = normalizePorts(input.ports);

  let record: ServiceRecord;
  try {
    record = await createServiceRecord(
      toCreateRecordPayload(input, {
        ports,
        serviceName,
        networkName,
        internalHostname,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new ServiceConflictError({ name: input.name }));
    }
    throw error;
  }

  const provisioned = await provisionFresh(input.projectId, record, projectSlug, log);
  if (provisioned.isErr()) return Result.err(provisioned.error);
  const runtime = provisioned.value;
  log.set({ provision: { service: serviceName, status: runtime.status } });

  const refreshed = await getServiceRecord(input.projectId, record.service.resourceId);
  return Result.ok(await mapServiceView(refreshed ?? record, projectSlug, runtime));
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

  const dependents = await findServiceDependentsByName({
    projectId: input.projectId,
    targetResourceName: record.resource.name,
  });
  const externalDependents = dependents.filter((id) => id !== input.resourceId);
  if (externalDependents.length > 0) {
    return Result.err(
      new ServiceInUseError({
        resourceId: input.resourceId,
        referrers: externalDependents as unknown as ReadonlyArray<ResourceId>,
      }),
    );
  }

  await deleteProxyRoutesByResource(input.resourceId);
  await runtime().destroy({ serviceName: record.service.serviceName }, log);
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

  // redeployOne now bumps ForceUpdate unconditionally — no explicit bump
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
