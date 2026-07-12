/**
 * Per-deployment task tray — the swarm tasks scheduled under a single
 * deployment id, newest first. Used by the Deployments tab to show the
 * retry cascade for one push.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { resolveDeploymentServiceName } from "./deployments-list";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";
import { composeChildSwarmServices, getResourceById } from "./queries/resource";
import {
  collapseInstanceState,
  listResourceInstances,
  type ResourceInstance,
} from "./resource-instances";

export interface DeploymentTaskInfo {
  id: string;
  projectId: ProjectId;
  resourceId: ResourceId;
  deploymentId: DeploymentId;
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

interface TasksByDeploymentInput {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  deploymentId: string;
}

function instanceTime(i: ResourceInstance): number {
  return new Date(i.updatedAt ?? i.createdAt ?? 0).getTime();
}

function toDeploymentTaskInfo(
  instance: ResourceInstance,
  input: TasksByDeploymentInput,
  serviceName: string,
): DeploymentTaskInfo {
  return {
    id: instance.id,
    projectId: input.projectId,
    resourceId: input.resourceId,
    deploymentId: input.deploymentId as DeploymentId,
    slot: instance.slot,
    label: instance.slot != null ? `${serviceName}.${instance.slot}` : serviceName,
    state: collapseInstanceState(instance.state),
    rawState: instance.state,
    desiredState: instance.desiredState,
    nodeId: instance.nodeId,
    message: instance.message,
    error: instance.err,
    containerId: instance.containerId,
    exitCode: instance.exitCode,
    timestamp: instance.updatedAt,
  };
}

export async function listTasksForDeployment(
  input: TasksByDeploymentInput,
): Promise<Result<DeploymentTaskInfo[], ProjectNotFoundError | PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const docker = Docker.fromEnv();

  // A compose STACK deployment tracks the whole rollout; its containers carry
  // the per-service (child) deployment ids, never the stack row's. Aggregate
  // every child service's instances and show the current set.
  if (found.kind === "compose") {
    const withNames: Array<{ instance: ResourceInstance; serviceName: string }> = [];
    for (const child of composeChildSwarmServices(found.record)) {
      const instancesResult = await listResourceInstances(docker, child.serviceName);
      if (instancesResult.isErr()) continue;
      for (const instance of instancesResult.value) {
        withNames.push({ instance, serviceName: child.serviceName });
      }
    }
    const sorted = withNames.sort((a, b) => instanceTime(b.instance) - instanceTime(a.instance));
    return Result.ok(sorted.map((e) => toDeploymentTaskInfo(e.instance, input, e.serviceName)));
  }

  const serviceName = await resolveDeploymentServiceName(found, input.projectId);
  if (!serviceName) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const instancesResult = await listResourceInstances(docker, serviceName);
  if (instancesResult.isErr()) return Result.ok([]);

  const filtered = instancesResult.value.filter((i) => i.deploymentId === input.deploymentId);
  const sorted = [...filtered].sort((a, b) => instanceTime(b) - instanceTime(a));

  return Result.ok(sorted.map((i) => toDeploymentTaskInfo(i, input, serviceName)));
}
