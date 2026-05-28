/**
 * Live swarm-task state for every service in a project. Drives the per-node
 * REPLICAS tray in the graph. Recomputed on every read — there's no caching
 * here; the frontend polls when it wants fresh state.
 *
 * Implementation:
 *   1. Load service rows (resourceId + serviceName) from the DB.
 *   2. Ask the swarm for every task across those services (one filtered call).
 *   3. Group by serviceName, map back to resourceId, collapse docker task
 *      states into the running/building/error bucket the graph cares about.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";
import type { ProjectRef } from "../scopes";

export interface ServiceTaskInfo {
  id: string;
  slot: number | null;
  label: string;
  state: "running" | "building" | "error";
  rawState: string | null;
  desiredState: string | null;
  nodeId: string | null;
  message: string | null;
  error: string | null;
  containerId: string | null;
  exitCode: number | null;
  timestamp: string | null;
}

export interface ServiceTasks {
  resourceId: ResourceId;
  tasks: ServiceTaskInfo[];
}

// Docker task `Status.State` values, collapsed to the three buckets the graph
// node tray renders. See https://docs.docker.com/reference/cli/docker/service/ps/
function collapseTaskState(state: string | undefined): ServiceTaskInfo["state"] {
  switch (state) {
    case "running":
      return "running";
    case "new":
    case "allocated":
    case "pending":
    case "assigned":
    case "accepted":
    case "preparing":
    case "ready":
    case "starting":
      return "building";
    case "failed":
    case "rejected":
    case "remove":
    case "orphaned":
      return "error";
    case "complete":
    case "shutdown":
      // A finished task on a long-running service signals a problem (the
      // orchestrator will replace it, but at this snapshot the slot is down).
      return "error";
    default:
      // Unknown state — treat as building so we don't false-positive errors.
      return "building";
  }
}

export async function listProjectServiceTasks(
  input: ProjectRef,
): Promise<Result<ServiceTasks[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const services = await db
    .select({
      resourceId: resource.id,
      serviceName: serviceResource.serviceName,
    })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(resource.projectId, input.projectId));

  if (services.length === 0) return Result.ok([]);

  // serviceName -> resourceId for grouping after the docker call.
  const nameToResourceId = new Map<string, ResourceId>();
  for (const s of services) nameToResourceId.set(s.serviceName, s.resourceId);

  // One docker call covers every service in the project. The filter accepts
  // multiple service names — `{ service: [a, b, c] }` means OR.
  const docker = Docker.fromEnv();
  const tasksResult = await docker.tasks.list({
    filters: { service: services.map((s) => s.serviceName) },
  });

  // Swarm may be missing / unreachable. Surface as an empty result rather
  // than failing the whole graph load — the UI can keep rendering nodes
  // without live state.
  if (tasksResult.isErr()) {
    return Result.ok(services.map((s) => ({ resourceId: s.resourceId, tasks: [] })));
  }

  const grouped = new Map<ResourceId, ServiceTaskInfo[]>();
  for (const s of services) grouped.set(s.resourceId, []);

  for (const task of tasksResult.value) {
    // Tasks identify their service by name via Spec.ContainerSpec, but the
    // simpler path is to walk our nameToResourceId map: docker echoes the
    // service name we filtered by in the task's labels under
    // `com.docker.swarm.service.name`.
    const serviceName =
      (task as { Spec?: { Name?: string } }).Spec?.Name ??
      (task as { Labels?: Record<string, string> }).Labels?.[
        "com.docker.swarm.service.name"
      ] ??
      null;
    if (!serviceName) continue;
    const resourceId = nameToResourceId.get(serviceName);
    if (!resourceId) continue;

    const status = (
      task as {
        Status?: {
          State?: string;
          Message?: string;
          Err?: string;
          Timestamp?: string;
          ContainerStatus?: { ContainerID?: string; ExitCode?: number };
        };
      }
    ).Status;
    const slot = (task as { Slot?: number }).Slot ?? null;
    const nodeId = (task as { NodeID?: string }).NodeID ?? null;
    const desiredState =
      (task as { DesiredState?: string }).DesiredState ?? null;

    const bucket = grouped.get(resourceId);
    if (!bucket) continue;
    bucket.push({
      id: (task as { ID?: string }).ID ?? "",
      slot,
      label: slot != null ? `${serviceName}.${slot}` : serviceName,
      state: collapseTaskState(status?.State),
      rawState: status?.State ?? null,
      desiredState,
      nodeId,
      message: status?.Message ?? null,
      error: status?.Err ?? null,
      containerId: status?.ContainerStatus?.ContainerID ?? null,
      exitCode:
        typeof status?.ContainerStatus?.ExitCode === "number"
          ? status.ContainerStatus.ExitCode
          : null,
      timestamp: status?.Timestamp ?? null,
    });
  }

  return Result.ok(
    services.map((s) => ({
      resourceId: s.resourceId,
      tasks: grouped.get(s.resourceId) ?? [],
    })),
  );
}
