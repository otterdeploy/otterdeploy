/**
 * The deployment row the overlay shows.
 *
 * Base rows come from the shared reactive collection. A preview row isn't in
 * that collection (it's previewId-scoped), so it's fetched directly when the
 * panel was opened from a preview. And a deep link that names a preview
 * deployment WITHOUT `previewId` (a shared URL, a link source that didn't know
 * it was in a preview) would otherwise spin forever — the fallback query asks
 * the server to resolve the scope from the row itself (`deploymentId` on the
 * list input), then the effect repairs the URL so everything `previewId`-scoped
 * (the chip, the preview's own host in the subline, the 5s-polling preview
 * listing) engages.
 */

import { useEffect } from "react";

import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { orpc } from "@/shared/server/orpc";

const routeApi = getRouteApi(
  "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId/deployment/$deploymentId",
);

export function useResolvedDeployment({
  projectId,
  resourceId,
  deploymentId,
  previewId,
}: {
  projectId: string;
  resourceId: string;
  deploymentId: string;
  previewId: string | undefined;
}) {
  const navigate = routeApi.useNavigate();
  const { data: baseDeployment = null } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) =>
          and(eq(d.projectId, projectId), eq(d.resourceId, resourceId), eq(d.id, deploymentId)),
        )
        .findOne(),
    [projectId, resourceId, deploymentId],
  );
  const previewDeployments = useQuery(
    orpc.project.resource.deployments.list.queryOptions({
      input: { projectId, resourceId, previewId: previewId ?? "" },
      enabled: !!previewId,
      refetchInterval: 5_000,
    }),
  );
  const fallbackDeployments = useQuery(
    orpc.project.resource.deployments.list.queryOptions({
      input: { projectId, resourceId, deploymentId },
      enabled: !previewId && baseDeployment === null,
      refetchInterval: 5_000,
    }),
  );
  const deployment = previewId
    ? (previewDeployments.data?.find((d) => d.id === deploymentId) ?? null)
    : (baseDeployment ?? fallbackDeployments.data?.find((d) => d.id === deploymentId) ?? null);

  const resolvedPreviewId = !previewId && deployment ? deployment.previewId : null;
  useEffect(() => {
    if (!resolvedPreviewId) return;
    void navigate({
      search: (prev) => ({ ...prev, previewId: resolvedPreviewId }),
      replace: true,
    });
  }, [resolvedPreviewId, navigate]);

  return deployment;
}
