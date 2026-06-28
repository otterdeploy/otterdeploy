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
import type { ComposeServiceSummary } from "@otterdeploy/shared/compose";
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { composeResource, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ProjectRef } from "../scopes";

import { composeSwarmServiceName } from "../../stack/compose";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";

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
// A finished task (complete/shutdown) on a long-running service signals a
// problem — the orchestrator will replace it, but at this snapshot the slot is
// down — so it buckets to "error".
const TASK_STATE_BUCKETS: Record<string, ServiceTaskInfo["state"]> = {
  running: "running",
  new: "building",
  allocated: "building",
  pending: "building",
  assigned: "building",
  accepted: "building",
  preparing: "building",
  ready: "building",
  starting: "building",
  failed: "error",
  rejected: "error",
  remove: "error",
  orphaned: "error",
  complete: "error",
  shutdown: "error",
};

// Unknown/missing states collapse to "building" so we don't false-positive errors.
function collapseTaskState(state: string | undefined): ServiceTaskInfo["state"] {
  return TASK_STATE_BUCKETS[state ?? ""] ?? "building";
}

interface TaskOwner {
  resourceId: ResourceId;
  service: string | null;
}

// Build the swarm-service-name → owner index. Plain services map their swarm
// name straight to the resource; compose stacks fan out to `${stack}-${svc}`
// names that map back to the stack resource AND the compose sub-service key.
function buildSwarmNameToOwner(
  services: { resourceId: ResourceId; serviceName: string }[],
  composes: { resourceId: ResourceId; stackName: string; services: ComposeServiceSummary[] }[],
): Map<string, TaskOwner> {
  const swarmNameToOwner = new Map<string, TaskOwner>();
  for (const s of services) {
    swarmNameToOwner.set(s.serviceName, { resourceId: s.resourceId, service: null });
  }
  for (const c of composes) {
    for (const sub of c.services) {
      const swarmName = composeSwarmServiceName(c.stackName, sub.name);
      swarmNameToOwner.set(swarmName, { resourceId: c.resourceId, service: sub.name });
    }
  }
  return swarmNameToOwner;
}

// Tasks identify their service by name via Spec.Name, falling back to the swarm
// label docker echoes for the service name we filtered by.
function resolveTaskServiceName(task: unknown): string | null {
  return (
    (task as { Spec?: { Name?: string } }).Spec?.Name ??
    (task as { Labels?: Record<string, string> }).Labels?.["com.docker.swarm.service.name"] ??
    null
  );
}

interface TaskStatusFields {
  state: string | undefined;
  rawState: string | null;
  message: string | null;
  error: string | null;
  containerId: string | null;
  exitCode: number | null;
  timestamp: string | null;
}

interface DockerTaskStatus {
  State?: string;
  Message?: string;
  Err?: string;
  Timestamp?: string;
  ContainerStatus?: { ContainerID?: string; ExitCode?: number };
}

// Normalize a docker task's `Status` block, mapping every missing field to null.
function readTaskStatus(task: unknown): TaskStatusFields {
  const status: DockerTaskStatus = (task as { Status?: DockerTaskStatus }).Status ?? {};
  const container = status.ContainerStatus ?? {};
  const exitCode = container.ExitCode;
  return {
    state: status.State,
    rawState: status.State ?? null,
    message: status.Message ?? null,
    error: status.Err ?? null,
    containerId: container.ContainerID ?? null,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    timestamp: status.Timestamp ?? null,
  };
}

// Map one docker task onto the graph's ServiceTaskInfo shape.
function buildTaskInfo(task: unknown, owner: TaskOwner, serviceName: string): ServiceTaskInfo {
  const status = readTaskStatus(task);
  const slot = (task as { Slot?: number }).Slot ?? null;
  const nodeId = (task as { NodeID?: string }).NodeID ?? null;
  const desiredState = (task as { DesiredState?: string }).DesiredState ?? null;
  // For a compose sub-service, label by the compose key (not the namespaced
  // swarm name) so the group's per-service rows read cleanly.
  const labelBase = owner.service ?? serviceName;
  return {
    id: (task as { ID?: string }).ID ?? "",
    slot,
    label: slot != null ? `${labelBase}.${slot}` : labelBase,
    service: owner.service,
    state: collapseTaskState(status.state),
    rawState: status.rawState,
    desiredState,
    nodeId,
    message: status.message,
    error: status.error,
    containerId: status.containerId,
    exitCode: status.exitCode,
    timestamp: status.timestamp,
  };
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
  const swarmNameToOwner = buildSwarmNameToOwner(services, composes);

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
    const serviceName = resolveTaskServiceName(task);
    if (!serviceName) continue;
    const owner = swarmNameToOwner.get(serviceName);
    if (!owner) continue;
    const bucket = grouped.get(owner.resourceId);
    if (!bucket) continue;
    bucket.push(buildTaskInfo(task, owner, serviceName));
  }

  return Result.ok(
    resourceIds.map((resourceId) => ({
      resourceId,
      tasks: grouped.get(resourceId) ?? [],
    })),
  );
}
