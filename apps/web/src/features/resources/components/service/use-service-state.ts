/**
 * The service panel's one status: {@link serviceState} fed from the live
 * `service.get` view, the latest deployment row and the live tasks. The header
 * pill, the Overview banner and the member strip all read THIS, so they cannot
 * disagree with each other (the old header read the schema row, the old
 * Overview tile read the runtime, and a crashed service showed both).
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { useResourceDeployments } from "@/features/resources/data/use-resource-deployments";
import { knownDeploymentStatus } from "@/features/resources/lib/known-deployment";
import {
  type DeploymentLifecycle,
  serviceState,
  type ResourceState,
} from "@/features/resources/lib/resource-state";

import type { LiveServiceView } from "./use-live-service";

export function useServiceState(input: {
  projectId: string;
  resourceId: string;
  /** The live view, undefined while loading or for a staged create. */
  service: LiveServiceView | undefined;
  /** Staged create: nothing to read, report pending rather than subscribe. */
  pending: boolean;
  /** The resource row's `latestDeploymentStatus`: what the graph node reads.
   *  Stands in until the panel's own deployment list has loaded, so the
   *  header and the node never disagree while it does. */
  latestDeploymentStatus?: DeploymentLifecycle | null;
}): ResourceState | null {
  const { projectId, resourceId, service, pending } = input;
  const { deployments, isLoading } = useResourceDeployments(projectId, resourceId, 1);
  const { data: taskRows } = useLiveQuery(
    (q) =>
      q
        .from({ t: serviceTasksCollection })
        .where(({ t }) => and(eq(t.projectId, projectId), eq(t.resourceId, resourceId))),
    [projectId, resourceId],
  );
  if (pending) return { tone: "pending", label: "pending", why: "deploys with the next apply" };
  const latest = deployments.at(0);
  return serviceState({
    pausedReplicas: service?.pausedReplicas,
    runtime: service?.runtime,
    latestDeployment: knownDeploymentStatus({
      listed: latest ? { status: latest.status } : undefined,
      listLoading: isLoading,
      fromResource: input.latestDeploymentStatus,
    }),
    tasks: taskRows.flatMap((row) => row.tasks),
  });
}
