/**
 * Service create/update via the existing service handlers — the manifest just
 * decides what to call, so the wire path is identical to the equivalent UI
 * clicks. The per-field patch builders are shared by create + update.
 */
import type { OrganizationId, ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { type ServiceManifest } from "../../stack/manifest";
import { addServiceDomain, setPrimaryServiceDomain } from "../service/domains";
import { bulkSetEnv, createService, exposeService, updateService } from "../service/handlers";
import { ManifestApplySkipError } from "./errors";

type OrgId = OrganizationId;

function buildPortsPatch(spec: ServiceManifest) {
  return spec.ports?.map((p) => ({
    containerPort: p.container,
    protocol: p.protocol,
    appProtocol: p.appProtocol,
    isPrimary: p.primary,
  }));
}

function buildHealthcheckPatch(spec: ServiceManifest) {
  return spec.healthcheck
    ? {
        cmd: spec.healthcheck.cmd,
        intervalMs: spec.healthcheck.intervalMs ?? null,
        timeoutMs: spec.healthcheck.timeoutMs ?? null,
        retries: spec.healthcheck.retries ?? null,
        startMs: spec.healthcheck.startMs ?? null,
      }
    : undefined;
}

function buildResourcesPatch(spec: ServiceManifest) {
  return spec.resources
    ? {
        cpuLimit: spec.resources.cpuLimit ?? null,
        memoryLimitMb: spec.resources.memoryMb ?? null,
        cpuReservation: spec.resources.cpuReservation ?? null,
        memoryReservationMb: spec.resources.memoryReservationMb ?? null,
        diskLimitMb: spec.resources.diskMb ?? null,
        swapLimitMb: spec.resources.swapMb ?? null,
        pidsLimit: spec.resources.pidsLimit ?? null,
      }
    : undefined;
}

interface CreateServiceArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  spec: ServiceManifest;
  env: Array<{ key: string; value: string }>;
  log: RequestLogger;
}

function buildCreateServiceInput(args: CreateServiceArgs): Parameters<typeof createService>[0] {
  // Git-sourced services start with a placeholder image — the builder
  // overwrites it on first build. The existing handler accepts the
  // placeholder; we still pass the manifest's command/entrypoint.
  const image = args.spec.source === "image" ? args.spec.image : "pending:initial";
  return {
    projectId: args.projectId,
    organizationId: args.organizationId,
    name: args.name,
    source: args.spec.source,
    // A git create on an unbound project should still land as a
    // `pending:initial` row (swarm skipped) — the missing build binding
    // surfaces below as a non-fatal "build not started" skip, not a hard
    // create failure that leaves the ghost stuck forever.
    skipBuildBindingCheck: true,
    sourceSubdir: args.spec.source === "git" ? (args.spec.sourceSubdir ?? null) : null,
    image,
    command: args.spec.startCommand ?? null,
    entrypoint: args.spec.entrypoint ?? null,
    replicas: args.spec.replicas ?? 1,
    ports: buildPortsPatch(args.spec) ?? [],
    env: args.env.length > 0 ? args.env : undefined,
    healthcheck: buildHealthcheckPatch(args.spec),
    restart: args.spec.restart,
    resources: buildResourcesPatch(args.spec),
    preDeploy: args.spec.preDeploy ?? null,
    postDeploy: args.spec.postDeploy ?? null,
    buildConfig: args.spec.source === "git" ? (args.spec.build ?? null) : null,
  };
}

export async function createServiceFromManifest(
  args: CreateServiceArgs,
): Promise<Result<{ resourceId: ResourceId }, ManifestApplySkipError>> {
  const result = await createService(buildCreateServiceInput(args), args.log);
  if (result.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "service",
        name: args.name,
        reason: `create failed: ${result.error.message}`,
      }),
    );
  }
  return Result.ok({ resourceId: result.value.id as ResourceId });
}

/**
 * Attach manifest-declared public domains to a just-created service, reusing
 * the same handlers the domains UI calls. Order matters: add the custom
 * routes first (they land disabled while the service is still unexposed),
 * then `exposeService` enables them in place — it won't mint a throwaway
 * generated host because real custom routes already exist — and finally pin
 * the operator's chosen primary. Every step's failure becomes a non-fatal
 * skip so a single bad domain never rolls back the created service.
 */
export async function seedServiceDomains(args: {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  name: string;
  domains: NonNullable<ServiceManifest["domains"]>;
  log: RequestLogger;
}): Promise<ManifestApplySkipError[]> {
  const skips: ManifestApplySkipError[] = [];
  const ref = {
    projectId: args.projectId,
    organizationId: args.organizationId,
    resourceId: args.resourceId,
  };
  const skip = (reason: string) =>
    skips.push(new ManifestApplySkipError({ resource: "service", name: args.name, reason }));

  let primaryRouteId: ProxyRouteId | null = null;
  for (const d of args.domains) {
    const added = await addServiceDomain({ ...ref, domain: d.domain }, args.log);
    if (added.isErr()) {
      skip(`domain ${d.domain} skipped: ${added.error.message}`);
      continue;
    }
    if (d.primary) primaryRouteId = added.value.id as ProxyRouteId;
  }

  // Nothing landed (e.g. no http port → every add failed) — don't expose.
  const routesAdded = primaryRouteId !== null || skips.length < args.domains.length;
  if (!routesAdded) return skips;

  const exposed = await exposeService(ref, args.log);
  if (exposed.isErr()) {
    skip(`expose skipped: ${exposed.error.message}`);
    return skips;
  }

  if (primaryRouteId) {
    const primed = await setPrimaryServiceDomain({ ...ref, routeId: primaryRouteId }, args.log);
    if (primed.isErr()) skip(`set primary domain skipped: ${primed.error.message}`);
  }
  return skips;
}

interface UpdateServiceArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  resourceId: ResourceId;
  spec: ServiceManifest;
  env: Array<{ key: string; value: string }>;
  log: RequestLogger;
}

function buildUpdateServiceInput(args: UpdateServiceArgs): Parameters<typeof updateService>[0] {
  const patch =
    args.spec.source === "image"
      ? { image: args.spec.image }
      : {
          /* git: image is builder-managed */
        };
  return {
    projectId: args.projectId,
    organizationId: args.organizationId,
    resourceId: args.resourceId,
    ...patch,
    command: args.spec.startCommand ?? undefined,
    entrypoint: args.spec.entrypoint ?? undefined,
    replicas: args.spec.replicas,
    ports: buildPortsPatch(args.spec),
    restart: args.spec.restart,
    healthcheck: buildHealthcheckPatch(args.spec),
    resources: buildResourcesPatch(args.spec),
    preDeploy: args.spec.preDeploy ?? null,
    postDeploy: args.spec.postDeploy ?? null,
    buildConfig: args.spec.source === "git" ? (args.spec.build ?? null) : null,
  };
}

export async function updateServiceFromManifest(
  args: UpdateServiceArgs,
): Promise<Result<{ resourceId: ResourceId }, ManifestApplySkipError>> {
  const updated = await updateService(buildUpdateServiceInput(args), args.log);
  if (updated.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "service",
        name: args.name,
        reason: `update failed: ${updated.error.message}`,
      }),
    );
  }

  // Reconcile env wholesale — bulkSetEnv replaces the set with what we pass.
  const envResult = await bulkSetEnv(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      resourceId: args.resourceId,
      vars: args.env,
    },
    args.log,
  );
  if (envResult.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "service",
        name: args.name,
        reason: `env reconcile failed: ${envResult.error.message}`,
      }),
    );
  }
  return Result.ok({ resourceId: args.resourceId });
}
