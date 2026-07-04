/**
 * Runtime-aware enumeration of a resource's container instances.
 *
 * The log/task tabs were written swarm-first: they called `docker.tasks.list`
 * directly, which only exists in Swarm. Under the DEFAULT plain-Docker runtime
 * (`DEPLOY_RUNTIME` unset) there are no swarm tasks, so every one of those calls
 * failed with "service <name> not found" — even for a perfectly healthy deploy,
 * and confusingly for a build that failed before any container was created.
 *
 * This normalizes both backends to one `ResourceInstance` shape:
 *   - Swarm  → `docker.tasks.list` (a task per replica/retry, with history).
 *   - Docker → `docker.containers.list` by the container name the driver uses
 *              (`serviceName`), reading the `otterdeploy.deployment.id` label the
 *              docker driver stamps on every container (docker-driver-helpers
 *              `otterLabels`). Plain Docker recreates in place, so there's at
 *              most one current container — no retry history, which is expected.
 *
 * An empty result now means "no container has run yet" (build in progress or
 * failed), which callers render as a helpful pointer to Build Logs rather than a
 * daemon error.
 */
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { isSwarmRuntime } from "../../runtime";

export interface ResourceInstance {
  /** Stable row/stream key: swarm task ID, or the container ID under Docker. */
  id: string;
  containerId: string | null;
  /** Raw backend state (swarm task `Status.State` or docker container `State`). */
  state: string | null;
  message: string | null;
  err: string | null;
  exitCode: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** The deployment this instance belongs to, when known (from the label / spec). */
  deploymentId: string | null;
  // Swarm-only placement fields (null under plain Docker — one container, no
  // replica slots or multi-node scheduling).
  slot: number | null;
  nodeId: string | null;
  desiredState: string | null;
}

export type InstanceStateBucket = "running" | "building" | "error";

// Backend states → the three buckets the graph/task trays render. Covers both
// swarm task states and plain-docker container states so callers don't each
// re-implement the collapse. Unknown/missing → "building" (never false-positive
// an error).
const STATE_BUCKETS: Record<string, InstanceStateBucket> = {
  // Swarm task states (https://docs.docker.com/reference/cli/docker/service/ps/).
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
  // Plain-docker container states ("running" shared above).
  created: "building",
  restarting: "building",
  exited: "error",
  dead: "error",
  paused: "error",
  removing: "error",
};

export function collapseInstanceState(state: string | null | undefined): InstanceStateBucket {
  return STATE_BUCKETS[state ?? ""] ?? "building";
}

interface SwarmTask {
  ID?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  Slot?: number;
  NodeID?: string;
  DesiredState?: string;
  Spec?: { ContainerSpec?: { Labels?: Record<string, string> } };
  Status?: {
    State?: string;
    Message?: string;
    Err?: string;
    Timestamp?: string;
    ContainerStatus?: { ContainerID?: string; ExitCode?: number };
  };
}

interface ContainerSummary {
  Id: string;
  Names?: string[];
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
  Created?: number;
}

// Coalesce undefined → null in one call so the mappers stay flat (each `?? null`
// otherwise counts toward cyclomatic complexity on these wide data shapes).
const orNull = <T>(v: T | undefined | null): T | null => v ?? null;

function taskToInstance(t: SwarmTask): ResourceInstance {
  const status = t.Status ?? {};
  const cs = status.ContainerStatus ?? {};
  const labels = t.Spec?.ContainerSpec?.Labels ?? {};
  return {
    id: t.ID ?? "",
    containerId: orNull(cs.ContainerID),
    state: orNull(status.State),
    message: orNull(status.Message),
    err: orNull(status.Err),
    exitCode: typeof cs.ExitCode === "number" ? cs.ExitCode : null,
    createdAt: orNull(t.CreatedAt),
    updatedAt: orNull(t.UpdatedAt ?? status.Timestamp),
    deploymentId: orNull(labels["otterdeploy.deployment.id"]),
    slot: orNull(t.Slot),
    nodeId: orNull(t.NodeID),
    desiredState: orNull(t.DesiredState),
  };
}

function containerToInstance(c: ContainerSummary): ResourceInstance {
  const created = typeof c.Created === "number" ? new Date(c.Created * 1000).toISOString() : null;
  return {
    id: c.Id,
    containerId: c.Id,
    state: orNull(c.State),
    // The list summary's human "Status" (e.g. "Exited (1) 2 minutes ago") is the
    // closest thing to a task message; the clean exit code isn't in the summary.
    message: orNull(c.Status),
    err: null,
    exitCode: null,
    createdAt: created,
    updatedAt: created,
    deploymentId: orNull(c.Labels?.["otterdeploy.deployment.id"]),
    slot: null,
    nodeId: null,
    desiredState: null,
  };
}

/**
 * List the container instances backing a resource's service. Runtime-aware:
 * swarm tasks or plain-docker containers. Returns Result so callers can tell a
 * genuine daemon error apart from an empty (not-yet-deployed) result.
 */
export async function listResourceInstances(
  docker: Docker,
  serviceName: string,
): Promise<Result<ResourceInstance[], Error>> {
  if (isSwarmRuntime()) {
    const res = await docker.tasks.list({ filters: { service: [serviceName] } });
    if (res.isErr()) return Result.err(res.error);
    return Result.ok((res.value as SwarmTask[]).map(taskToInstance));
  }

  // Plain Docker: containers are named exactly `serviceName`. The name filter is
  // a substring match, so pin to the exact `/name` (docker prefixes a slash).
  const res = await docker.containers.list({ all: true, filters: { name: [serviceName] } });
  if (res.isErr()) return Result.err(res.error);
  const exact = (res.value as ContainerSummary[]).filter((c) =>
    c.Names?.some((n) => n === `/${serviceName}` || n === serviceName),
  );
  return Result.ok(exact.map(containerToInstance));
}
