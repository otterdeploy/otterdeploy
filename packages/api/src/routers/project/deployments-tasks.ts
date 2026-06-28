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

// Docker task `Status.State` collapsed to the three buckets the per-deployment
// task tray renders. Unknown/missing states map to "building" so we don't
// false-positive errors.
const TASK_STATE_BUCKETS: Record<string, DeploymentTaskInfo["state"]> = {
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

function collapseTaskState(state: string | undefined): DeploymentTaskInfo["state"] {
  return TASK_STATE_BUCKETS[state ?? ""] ?? "building";
}

function taskCreatedTime(task: unknown): number {
  const t = task as { UpdatedAt?: string; CreatedAt?: string };
  return new Date(t.UpdatedAt ?? t.CreatedAt ?? 0).getTime();
}

function toDeploymentTaskInfo(
  task: unknown,
  input: TasksByDeploymentInput,
  serviceName: string,
): DeploymentTaskInfo {
  const status =
    (
      task as {
        Status?: {
          State?: string;
          Message?: string;
          Err?: string;
          Timestamp?: string;
          ContainerStatus?: { ContainerID?: string; ExitCode?: number };
        };
      }
    ).Status ?? {};
  const container = status.ContainerStatus ?? {};
  const exitCode = container.ExitCode;
  const slot = (task as { Slot?: number }).Slot ?? null;
  return {
    id: (task as { ID?: string }).ID ?? "",
    projectId: input.projectId,
    resourceId: input.resourceId,
    deploymentId: input.deploymentId as DeploymentId,
    slot,
    label: slot != null ? `${serviceName}.${slot}` : serviceName,
    state: collapseTaskState(status.State),
    rawState: status.State ?? null,
    desiredState: (task as { DesiredState?: string }).DesiredState ?? null,
    nodeId: (task as { NodeID?: string }).NodeID ?? null,
    message: status.Message ?? null,
    error: status.Err ?? null,
    containerId: container.ContainerID ?? null,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    timestamp: status.Timestamp ?? null,
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
  const tasksResult = await docker.tasks.list({
    filters: { service: [serviceName] },
  });
  if (tasksResult.isErr()) return Result.ok([]);

  const filtered = tasksResult.value.filter((task) => {
    const labels =
      (task as { Spec?: { ContainerSpec?: { Labels?: Record<string, string> } } }).Spec
        ?.ContainerSpec?.Labels ?? {};
    return labels["otterdeploy.deployment.id"] === input.deploymentId;
  });

  const sorted = [...filtered].sort((a, b) => taskCreatedTime(b) - taskCreatedTime(a));

  return Result.ok(sorted.map((t) => toDeploymentTaskInfo(t, input, serviceName)));
}
