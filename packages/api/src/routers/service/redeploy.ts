/**
 * Redeploy primitives — re-apply a single service to Swarm and optionally
 * fan out to its transitive dependents (services that reference it via
 * `${{<name>.<VAR>}}` env tokens).
 */

import { Result } from "better-result";

import { findTransitiveDependents, resolveServiceEnv } from "../../lib/variables";
import {
  provisionSwarmService,
  updateSwarmService,
  type SwarmServiceRuntime,
} from "../../swarm";
import type { RequestLogger } from "evlog";

import { type ProjectId } from "../project/errors";
import { ServiceNotFoundError, type ResolveError, type ResourceId } from "./errors";
import {
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
  const resolved = await resolveServiceEnv(
    projectId,
    record.service.resourceId as ResourceId,
  );
  if (resolved.isErr()) {
    await updateServiceResourceStatus(record.service.resourceId, "invalid");
    return Result.err(resolved.error);
  }

  const runtime = await provisionSwarmService(
    buildSwarmSpec(record, resolved.value, sanitizeSlug(projectSlug)),
    log,
  );
  await updateServiceResourceStatus(
    record.service.resourceId,
    runtime.status === "error" ? "invalid" : "valid",
  );

  return Result.ok(runtime);
}

export async function redeployOne(
  projectId: ProjectId,
  resourceId: ResourceId,
  projectSlug: string,
  log?: RequestLogger,
): Promise<Result<true, ServiceNotFoundError | ResolveError>> {
  const record = await getServiceRecord(projectId, resourceId);
  if (!record) {
    return Result.err(new ServiceNotFoundError({ resourceId }));
  }

  const resolved = await resolveServiceEnv(projectId, resourceId);
  if (resolved.isErr()) {
    await updateServiceResourceStatus(resourceId, "invalid");
    return Result.err(resolved.error);
  }

  const runtime = await updateSwarmService(
    buildSwarmSpec(record, resolved.value, sanitizeSlug(projectSlug)),
    log,
  );
  await updateServiceResourceStatus(
    resourceId,
    runtime.status === "error" ? "invalid" : "valid",
  );

  return Result.ok(true);
}

export async function redeployAndFanOut(
  projectId: ProjectId,
  resourceId: ResourceId,
  projectSlug: string,
  log: RequestLogger,
): Promise<Result<true, ServiceNotFoundError | ResolveError>> {
  const result = await redeployOne(projectId, resourceId, projectSlug, log);
  if (result.isErr()) return result;

  const sourceRecord = await getServiceRecord(projectId, resourceId);
  if (!sourceRecord) return Result.ok(true);

  const dependents = await findTransitiveDependents({
    projectId,
    targetResourceId: resourceId,
    targetResourceName: sourceRecord.resource.name,
  });

  log.set({ fanout: { count: dependents.length } });

  for (const depId of dependents) {
    const depResult = await redeployOne(
      projectId,
      depId as ResourceId,
      projectSlug,
      log,
    );
    if (depResult.isErr()) {
      // One failed dependent shouldn't undo the rest, but we surface the first error.
      return depResult;
    }
  }

  return Result.ok(true);
}
