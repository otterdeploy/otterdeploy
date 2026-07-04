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
import { getResourceById } from "./queries/resource";
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

  const serviceName = await resolveDeploymentServiceName(found, input.projectId);

  const docker = Docker.fromEnv();
  const instancesResult = await listResourceInstances(docker, serviceName);
  if (instancesResult.isErr()) return Result.ok([]);

  const filtered = instancesResult.value.filter((i) => i.deploymentId === input.deploymentId);
  const sorted = [...filtered].sort((a, b) => instanceTime(b) - instanceTime(a));

  return Result.ok(sorted.map((i) => toDeploymentTaskInfo(i, input, serviceName)));
}
