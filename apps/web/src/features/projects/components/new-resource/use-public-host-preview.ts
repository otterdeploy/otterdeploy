/**
 * Server-resolved preview of the public FQDN a service with this name would
 * publish at (`project.resource.publicHostPreview`, the same chain the
 * expose path walks). One source of truth for the Networking step's hostname
 * placeholder, the Review step's Access row, and the create payload, so what
 * the wizard SHOWS is exactly what Apply stages. Carries whether that host can
 * hold a trusted certificate, so neither step promises Let's Encrypt for an
 * address that will be served self-signed.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { skipToken, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export interface PublicHostPreview {
  fqdn: string;
  /** False when the host can never be served with a publicly trusted
   *  certificate (the sslip.io fallback, the local dev base): it goes out
   *  self-signed and the wizard has to say so. */
  publicCertEligible: boolean;
}

export function usePublicHostPreview(projectId: ProjectId, name: string): PublicHostPreview | null {
  const trimmed = name.trim();
  const query = useQuery({
    ...orpc.project.resource.publicHostPreview.queryOptions({
      input: trimmed ? { projectId, name: trimmed } : skipToken,
    }),
    staleTime: 60 * 1000,
  });
  if (!query.data) return null;
  return { fqdn: query.data.fqdn, publicCertEligible: query.data.publicCertEligible };
}
