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
import {
  composeResource,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";
import { composeSwarmServiceName } from "../../stack/compose";
import type { ProjectRef } from "../scopes";

export interface ServiceTaskInfo {
  id: string;
  slot: number | null;
  label: string;
  /** For a compose stack: the sub-service (compose key) this task belongs to,
   *  so the group node can roll status up per service. `null` for a plain
   *  single-service resource (the whole resource is one service). */
  service: string | null;
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

  // Compose stacks fan out to N swarm services (`${stack}-${svc}`), each
  // labelled with the stack's resourceId. We resolve every sub-service's swarm
  // name up front so its tasks map back to the stack AND to the sub-service the
  // group node rolls status up per — that's what makes "which service is up?"
  // answerable instead of one pill for the whole stack.
  const composes = await db
    .select({
      resourceId: resource.id,
      stackName: composeResource.stackName,
      services: composeResource.services,
    })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(eq(resource.projectId, input.projectId));

  // swarmName -> { resourceId, service }. `service` is the compose sub-service
  // key (null for plain single-service resources).
  const swarmNameToOwner = new Map<
    string,
    { resourceId: ResourceId; service: string | null }
  >();
  for (const s of services) {
    swarmNameToOwner.set(s.serviceName, {
      resourceId: s.resourceId,
      service: null,
    });
  }
  for (const c of composes) {
    for (const sub of c.services) {
      const swarmName = composeSwarmServiceName(c.stackName, sub.name);
      swarmNameToOwner.set(swarmName, {
        resourceId: c.resourceId,
        service: sub.name,
      });
    }
  }

  // Every resource that should appear in the result, even with zero tasks, so
  // the graph can render a node/group as "offline" rather than omit it.
  const resourceIds = [
    ...new Set<ResourceId>([
      ...services.map((s) => s.resourceId),
      ...composes.map((c) => c.resourceId),
    ]),
  ];
  if (resourceIds.length === 0) return Result.ok([]);

  // One docker call covers every service in the project. The filter accepts
  // multiple service names — `{ service: [a, b, c] }` means OR.
  const docker = Docker.fromEnv();
  const tasksResult = await docker.tasks.list({
    filters: { service: [...swarmNameToOwner.keys()] },
  });

  // Swarm may be missing / unreachable. Surface as an empty result rather
  // than failing the whole graph load — the UI can keep rendering nodes
  // without live state.
  if (tasksResult.isErr()) {
    return Result.ok(resourceIds.map((resourceId) => ({ resourceId, tasks: [] })));
  }

  const grouped = new Map<ResourceId, ServiceTaskInfo[]>();
  for (const resourceId of resourceIds) grouped.set(resourceId, []);

  for (const task of tasksResult.value) {
    // Tasks identify their service by name via Spec.ContainerSpec, but the
    // simpler path is to walk our swarmNameToOwner map: docker echoes the
    // service name we filtered by in the task's labels under
    // `com.docker.swarm.service.name`.
    const serviceName =
      (task as { Spec?: { Name?: string } }).Spec?.Name ??
      (task as { Labels?: Record<string, string> }).Labels?.[
        "com.docker.swarm.service.name"
      ] ??
      null;
    if (!serviceName) continue;
    const owner = swarmNameToOwner.get(serviceName);
    if (!owner) continue;
    const resourceId = owner.resourceId;

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
    // For a compose sub-service, label by the compose key (not the namespaced
    // swarm name) so the group's per-service rows read cleanly.
    const labelBase = owner.service ?? serviceName;
    bucket.push({
      id: (task as { ID?: string }).ID ?? "",
      slot,
      label: slot != null ? `${labelBase}.${slot}` : labelBase,
      service: owner.service,
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
    resourceIds.map((resourceId) => ({
      resourceId,
      tasks: grouped.get(resourceId) ?? [],
    })),
  );
}
