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
import { serviceState, type ResourceState } from "@/features/resources/lib/resource-state";

import type { LiveServiceView } from "./use-live-service";

export function useServiceState(input: {
  projectId: string;
  resourceId: string;
  /** The live view, undefined while loading or for a staged create. */
  service: LiveServiceView | undefined;
  /** Staged create: nothing to read, report pending rather than subscribe. */
  pending: boolean;
}): ResourceState | null {
  const { projectId, resourceId, service, pending } = input;
  const { deployments } = useResourceDeployments(projectId, resourceId, 1);
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
    latestDeployment: latest
      ? { status: latest.status, errorMessage: latest.errorMessage }
      : undefined,
    tasks: taskRows.flatMap((row) => row.tasks),
  });
}
