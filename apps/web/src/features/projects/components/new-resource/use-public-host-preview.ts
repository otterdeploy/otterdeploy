/**
 * Server-resolved preview of the public FQDN a service with this name would
 * publish at (`project.resource.publicHostPreview`, the same chain the
 * expose path walks). One source of truth for the Networking step's hostname
 * placeholder, the Review step's Access row, and the create payload, so what
 * the wizard SHOWS is exactly what Apply stages.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { skipToken, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export function usePublicHostPreview(projectId: ProjectId, name: string): string | null {
  const trimmed = name.trim();
  const query = useQuery({
    ...orpc.project.resource.publicHostPreview.queryOptions({
      input: trimmed ? { projectId, name: trimmed } : skipToken,
    }),
    staleTime: 60 * 1000,
  });
  return query.data?.fqdn ?? null;
}
