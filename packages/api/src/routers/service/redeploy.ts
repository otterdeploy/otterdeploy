/**
 * Redeploy primitives — re-apply a single service to Swarm and optionally
 * fan out to its transitive dependents (services that reference it via
 * `${{<name>.<VAR>}}` env tokens).
 */
import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { SwarmServiceRuntime } from "../../swarm";

import { loadPreviewScope } from "../../lib/environment/load";
import { findTransitiveDependents, resolveServiceEnv } from "../../lib/variables";
import { runtime } from "../../runtime";
import { ServiceNotFoundError, type ResolveError } from "./errors";
import {
  bumpForceUpdateCounter,
  getServiceRecord,
  type ServiceRecord,
  updateServiceResourceStatus,
} from "./queries";
import { buildSwarmSpec } from "./spec";
import { sanitizeSlug } from "./views";
/**
 * Resolve env for a freshly-created `ServiceRecord` and provision its
 * swarm service. Mirrors `redeployOne` but uses `provisionSwarmService`
 * for the create path. Returns the live runtime on success.
 */
export async function provisionFresh(
  projectId: ProjectId,
  record: ServiceRecord,
  projectSlug: string,
  log?: RequestLogger,
): Promise<Result<SwarmServiceRuntime, ResolveError>> {
  // Git-sourced services start life with a placeholder image (no build
  // has happened yet). Skip the swarm provision step — the build worker
  // will set the real image + drive convergence on first push. Return a
  // synthetic "pending" runtime so callers don't see an error.
  if (isPendingImage(record.service.image)) {
    await updateServiceResourceStatus(record.service.resourceId, "valid");
    return Result.ok({
      serviceId: null,
      serviceName: record.service.serviceName,
      networkName: record.service.networkName,
      status: "starting",
      health: null,
    });
  }

  const resolved = await resolveServiceEnv(projectId, record.service.resourceId as ResourceId);
  if (resolved.isErr()) {
    await updateServiceResourceStatus(record.service.resourceId, "invalid");
    return Result.err(resolved.error);
  }

  const swarmSpec = await buildSwarmSpec(record, resolved.value, sanitizeSlug(projectSlug));
  // provisionSwarmService THROWS on any Docker/Swarm infra error (no
  // reachable manager, network create failure, …). Letting that escape
  // would crash the whole `manifest.apply` (a single unreachable swarm →
  // HTTP 500, "Apply failed") and strand a draft row. Convert it into an
  // errored runtime instead: the resource lands marked `invalid` and shows
  // as an error node on the graph, recoverable via the panel's redeploy —
  // far better than a 500 that deploys nothing visible.
  const provisioned = await Result.tryPromise({
    try: () => runtime().provision(swarmSpec, log),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  const result: SwarmServiceRuntime = provisioned.isOk()
    ? provisioned.value
    : {
        serviceId: null,
        serviceName: record.service.serviceName,
        networkName: record.service.networkName,
        status: "error",
        health: null,
      };
  if (provisioned.isErr()) {
    log?.set({
      provisionError: {
        service: record.service.serviceName,
        reason: provisioned.error,
      },
    });
  }
  await updateServiceResourceStatus(
    record.service.resourceId,
    result.status === "error" ? "invalid" : "valid",
  );

  return Result.ok(result);
}

/** Placeholder images used by git-sourced services before their first build. */
function isPendingImage(image: string): boolean {
  return image.startsWith("pending:");
}

export interface RedeployOptions {
  /** Target a PR preview. Omitted → the base deploy, byte-identical to
   *  production behavior. */
  previewId?: PreviewId;
  /** Use this image in the spec instead of the stored serviceResource.image —
   *  preview builds pass their built tag here so they don't clobber the base. */
  imageOverride?: string;
}

export async function redeployOne(
  projectId: ProjectId,
  resourceId: ResourceId,
  projectSlug: string,
  log?: RequestLogger,
  opts?: RedeployOptions,
): Promise<Result<SwarmServiceRuntime, ServiceNotFoundError | ResolveError>> {
  // Bump ForceUpdate BEFORE loading the record so buildSwarmSpec
  // serializes the new counter into TaskTemplate.ForceUpdate. Without
  // this, "redeploy" with no spec changes would no-op at swarm — the
  // task would never roll because nothing in the diff'd template
  // changed. updateService callers, env-var setters, and expose paths
  // all funnel through redeployOne, so doing it here covers every
  // redeploy entry point instead of relying on each handler to remember.
  await bumpForceUpdateCounter(resourceId);

  const record = await getServiceRecord(projectId, resourceId);
  if (!record) {
    return Result.err(new ServiceNotFoundError({ resourceId }));
  }

  const resolved = await resolveServiceEnv(projectId, resourceId, opts?.previewId);
  if (resolved.isErr()) {
    // A preview override resolve failure must not corrupt the BASE resource's
    // status — the base row is shared across production and every preview.
    if (!opts?.previewId) await updateServiceResourceStatus(resourceId, "invalid");
    return Result.err(resolved.error);
  }

  const previewScope = await loadPreviewScope(opts?.previewId);
  const swarmSpec = await buildSwarmSpec(
    record,
    resolved.value,
    sanitizeSlug(projectSlug),
    previewScope,
    opts?.imageOverride,
  );
  const result = await runtime().update(swarmSpec, log);
  // Same guard: a preview roll's outcome never rewrites the base status.
  if (!opts?.previewId) {
    await updateServiceResourceStatus(resourceId, result.status === "error" ? "invalid" : "valid");
  }

  return Result.ok(result);
}

export async function redeployAndFanOut(
  projectId: ProjectId,
  resourceId: ResourceId,
  projectSlug: string,
  log: RequestLogger,
): Promise<Result<true, ServiceNotFoundError | ResolveError>> {
  const result = await redeployOne(projectId, resourceId, projectSlug, log);
  if (result.isErr()) return Result.err(result.error);

  const sourceRecord = await getServiceRecord(projectId, resourceId);
  if (!sourceRecord) return Result.ok(true);

  const dependents = await findTransitiveDependents({
    projectId,
    targetResourceId: resourceId,
    targetResourceName: sourceRecord.resource.name,
  });

  log.set({ fanout: { count: dependents.length } });

  for (const depId of dependents) {
    const depResult = await redeployOne(projectId, depId as ResourceId, projectSlug, log);
    if (depResult.isErr()) {
      // One failed dependent shouldn't undo the rest, but we surface the first error.
      return Result.err(depResult.error);
    }
  }

  return Result.ok(true);
}
