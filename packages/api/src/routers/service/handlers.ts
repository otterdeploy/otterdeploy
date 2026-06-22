/**
 * Orchestration layer for the Service primitive. Stitches together the
 * queries module, the Swarm provisioner, the variable resolver, and the
 * Caddy reconciler.
 *
 * Returns `Result<View, TaggedError>` so the oRPC handler layer can switch
 * on `result.error._tag` to translate to the right wire-level error code.
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import type { ProjectNotFoundError } from "../project/errors";
import {
  getResourceDeploymentById,
  insertDeployment,
  markDeploymentFailed,
} from "../project/deployments";

import { reconcile } from "../../caddy";
import {
  clearPrimaryForResource,
  deleteProxyRoutesByResource,
  insertProxyRoute,
  listProxyRoutesByResourceId,
  setRoutesEnabledForResource,
  updateProxyRoute,
} from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain } from "../../lib/domains";
import { runtime } from "../../runtime";

import { loadProject, loadResource } from "./context";
import { MissingProjectBuildBindingError, NoHttpPortError, NotRollbackableError, ServiceConflictError, ServiceInUseError, ServiceNotFoundError, type ResolveError } from "./errors";
import {
  type CreateServiceInput,
  type ProjectRef,
  type ResourceRef,
  type UpdateServiceInput,
  toCreateRecordPayload,
  toUpdateRecordPatch,
} from "./inputs";
import {
  bulkReplaceServiceEnvVars, createServiceRecord,
  deleteServiceEnvVar, deleteServiceRecord, findServiceDependentsByName,
  getPrimaryHttpPort, getServiceRecord, getServiceRecordByName,
  listServiceRecordsByProject, replaceServicePorts, setPublicExposure,
  updateServiceRecord, upsertServiceEnvVar, type ServiceRecord,
} from "./queries";
import { provisionFresh, redeployAndFanOut } from "./redeploy";
import {
  isUniqueViolation, mapEnvVar, mapServiceView, normalizePorts, sanitizeSlug,
  type EnvVarView, type ServiceView,
} from "./views";

export type { EnvVarView, ServiceView } from "./views";
export type { CreateServiceInput, UpdateServiceInput } from "./inputs";

// Common error shapes — keep handler signatures legible.
type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

export async function listServices(
  input: ProjectRef,
): Promise<Result<ServiceView[], ProjectNotFoundError>> {
  const project = await loadProject(input);
  if (project.isErr()) return Result.err(project.error);

  const records = await listServiceRecordsByProject(input.projectId);
  const views = await Promise.all(
    records.map((r) => mapServiceView(r, project.value.slug)),
  );
  return Result.ok(views);
}

export async function getService(
  input: ResourceRef,
): Promise<Result<ServiceView, NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  return Result.ok(await mapServiceView(ctx.value.record, ctx.value.project.slug));
}

export async function listEnv(
  input: ResourceRef,
): Promise<Result<EnvVarView[], NotFound>> {
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
    | ProjectNotFoundError
    | ServiceConflictError
    | MissingProjectBuildBindingError
    | ResolveError
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
  const serviceName = `${PLATFORM.service.serviceNamePrefix}${projectSlug}-${resourceSlug}`.slice(0, 63);
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

/**
 * Roll a service back to a prior deployment's image. Image-only: it re-points
 * `serviceResource.image` at the target deployment's tag and re-rolls — the
 * service's current env/config/secrets are kept (you want the old code with
 * today's config, not an old env that may reference deleted resources). The
 * roll is recorded as a new `reason:"rollback"` deployment so it shows in
 * history and can itself be rolled back. The target must be a settled deploy
 * with a real (non-`pending:`) image.
 */
export async function rollbackService(
  input: ResourceRef & { deploymentId: DeploymentId },
  log: RequestLogger,
): Promise<Result<ServiceView, RedeployFailure | NotRollbackableError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const target = await getResourceDeploymentById(
    input.resourceId,
    input.deploymentId,
  );
  if (!target) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }
  if (target.status !== "running" && target.status !== "superseded") {
    return Result.err(
      new NotRollbackableError({
        resourceId: input.resourceId,
        reason: `deployment is ${target.status}, not a settled successful deploy`,
      }),
    );
  }
  if (!target.image || target.image.startsWith("pending:")) {
    return Result.err(
      new NotRollbackableError({
        resourceId: input.resourceId,
        reason: "deployment has no built image",
      }),
    );
  }

  const previousImage = ctx.value.record.service.image;
  // Pin by the target's tag; clear the digest (the deployment row stores no
  // digest, and the tag still resolves the rolled-back image).
  await db
    .update(serviceResource)
    .set({ image: target.image, imageDigest: null })
    .where(eq(serviceResource.resourceId, input.resourceId));

  const row = await insertDeployment({
    resourceId: input.resourceId,
    image: target.image,
    reason: "rollback",
    snapshot: {
      rolledBackToDeploymentId: target.id,
      previousImage,
    },
  });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) {
    await markDeploymentFailed(row.id, redeployed.error.message);
    return Result.err(redeployed.error);
  }

  await db
    .update(deployment)
    .set({ status: "running", completedAt: new Date() })
    .where(eq(deployment.id, row.id));

  return getService(input);
}

export async function exposeService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound | NoHttpPortError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { project, record } = ctx.value;

  const primary = getPrimaryHttpPort(record.ports);
  if (!primary) {
    return Result.err(new NoHttpPortError({ resourceId: input.resourceId }));
  }

  // A service can carry several hosts (one proxy_route each). Expose no
  // longer wipes-and-reinserts a single route — that would drop the
  // operator's custom domains and their guests. It brings already-verified
  // hosts back live, and guarantees at least one live host by minting the
  // generated one whenever nothing else is serving.
  await setRoutesEnabledForResource(input.resourceId, true);
  for (const r of await listProxyRoutesByResourceId(input.resourceId)) {
    // Refresh the upstream in case the primary HTTP port moved while the
    // service was unexposed.
    if (
      r.upstreamPort !== primary.containerPort ||
      r.upstreamHost !== record.service.internalHostname
    ) {
      await updateProxyRoute(r.id, {
        upstreamPort: primary.containerPort,
        upstreamHost: record.service.internalHostname,
      });
    }
  }

  let routes = await listProxyRoutesByResourceId(input.resourceId);
  if (!routes.some((r) => r.enabled)) {
    // Nothing live — either a first expose or every host is still a pending
    // custom. Mint the generated host so expose actually exposes something.
    const projectSlug = sanitizeSlug(project.slug);
    const resourceSlug = sanitizeSlug(record.resource.name);
    // Walk the chain (resource override → project → org → sslip). The
    // per-resource `publicDomain` column on serviceResource is what feeds
    // resourceOverride — operators who already typed a literal FQDN in
    // the service settings get it back untouched.
    const sources = (await loadDomainSourcesForProject(input.projectId)) ?? {
      resourceOverride: null,
      projectCustomDomain: null,
      projectCustomDomainVerifiedAt: null,
      orgBaseDomain: null,
      orgBaseDomainVerifiedAt: null,
      localBaseDomain: null,
      serverIp: null,
    };
    const resolved = resolvePublicDomain(
      { resourceSlug, projectSlug, kind: "service" },
      { ...sources, resourceOverride: record.service.publicDomain },
    );
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "http",
      domain: resolved.fqdn,
      upstreamHost: record.service.internalHostname,
      upstreamPort: primary.containerPort,
      protocol: "http",
      // ACME only when the resolver decided the domain is verified and not
      // a sslip fallback — same gate as the DB path.
      usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
      enabled: true,
      source: "generated",
      // Becomes primary only if no other route already claims it.
      isPrimary: !routes.some((r) => r.isPrimary),
      // Generated hosts resolve to us by construction (sslip/local/org apex).
      dnsState: "pointed",
    });
    routes = await listProxyRoutesByResourceId(input.resourceId);
  }

  // Settle the primary on a live host: keep the flagged one if it's live,
  // else promote any live route (falling back to any route at all).
  const flagged = routes.find((r) => r.isPrimary && r.enabled);
  const primaryRoute =
    flagged ?? routes.find((r) => r.enabled) ?? routes.find((r) => r.isPrimary) ?? routes[0];
  if (primaryRoute && !primaryRoute.isPrimary) {
    await clearPrimaryForResource(input.resourceId);
    await updateProxyRoute(primaryRoute.id, { isPrimary: true });
  }
  const publicDomain = primaryRoute?.domain ?? null;

  await setPublicExposure({
    resourceId: input.resourceId,
    enabled: true,
    publicDomain,
  });

  const reconcileResult = await reconcile(log);
  log.set({
    expose: {
      domain: publicDomain,
      applied: reconcileResult.applied.includes(input.projectId),
    },
  });

  return getService(input);
}

export async function unexposeService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  // Disable every host without deleting the rows — the operator's custom
  // domains, their verification, and their guests survive so a later
  // re-expose brings them straight back.
  await setRoutesEnabledForResource(input.resourceId, false);
  await setPublicExposure({
    resourceId: input.resourceId,
    enabled: false,
    publicDomain: null,
  });
  await reconcile(log);
  log.set({ unexpose: { service: ctx.value.record.service.serviceName } });

  return getService(input);
}

export async function setEnv(
  input: ResourceRef & { key: string; value: string },
  log: RequestLogger,
): Promise<Result<EnvVarView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const row = await upsertServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
    value: input.value,
  });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(mapEnvVar(row));
}

export async function unsetEnv(
  input: ResourceRef & { key: string },
  log: RequestLogger,
): Promise<Result<{ ok: true }, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const removed = await deleteServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
  });
  if (!removed) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok({ ok: true });
}

export async function bulkSetEnv(
  input: ResourceRef & { vars: Array<{ key: string; value: string }> },
  log: RequestLogger,
): Promise<Result<EnvVarView[], RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const rows = await bulkReplaceServiceEnvVars(input.resourceId, input.vars);
  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(rows.map(mapEnvVar));
}
