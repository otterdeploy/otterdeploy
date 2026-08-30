/**
 * One resource's deployments, newest first.
 *
 * Every surface that shows a deployment (the Deployments tab, all three
 * Overviews, the Logs tab's build/deploy sources, the service's own state)
 * needs the same rows in the same order, so they read them through here rather
 * than each writing the same live query with its own idea of the ordering.
 * `createdAt` is an ISO-8601 string, so lexicographic desc == chronological.
 *
 * `isLoading` is reported separately because "none yet" and "not fetched yet"
 * are different answers: a resource that has never deployed must reach its
 * empty state, not sit on a spinner forever.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { DeploymentInfo } from "../components/_shared/deployment-cards";

import { deploymentsCollection } from "./deployments";

export function useResourceDeployments(
  projectId: string,
  resourceId: string,
  limit?: number,
): { deployments: DeploymentInfo[]; isLoading: boolean } {
  const { data, status } = useLiveQuery(
    (q) => {
      const rows = q
        .from({ d: deploymentsCollection })
        .where(({ d }) => and(eq(d.projectId, projectId), eq(d.resourceId, resourceId)))
        .orderBy(({ d }) => d.createdAt, "desc");
      return limit == null ? rows : rows.limit(limit);
    },
    [projectId, resourceId, limit],
  );
  return { deployments: data, isLoading: status === "loading" && data.length === 0 };
}
