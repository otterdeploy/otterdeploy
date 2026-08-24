/**
 * Live TLS-certificate probing for a project's enabled HTTP domains. Connects
 * to the edge with each domain as SNI: single node reaches Caddy on loopback,
 * multi-node via the configured server IP. Results are live, never cached.
 */

import { Result } from "better-result";

import type { ProjectRef } from "../scopes";

import { listProxyRoutesByProject } from "../../caddy/queries";
import { type CertProbe, probeCertificate } from "../../lib/cert-probe";
import { readEdgeHost } from "../../lib/edge-host";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";

export interface ProjectCertificates {
  /** The edge address we probed (server IP, or loopback on a single node). */
  edgeHost: string;
  /** ISO-8601: when the probe ran (results are live, not cached). */
  probedAt: string;
  certificates: CertProbe[];
}

/** Probe the live TLS certificate Caddy serves for each of a project's enabled
 *  HTTP domains. Org-scoped via the same project lookup as the route list. */
export async function listProjectCertificates(
  input: ProjectRef,
): Promise<Result<ProjectCertificates, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const records = (await listProxyRoutesByProject(input.projectId)).filter(
    (r) => r.previewId == null,
  );
  const domains = [
    ...new Set(records.filter((r) => r.type === "http" && r.enabled).map((r) => r.domain)),
  ];

  const edgeHost = await readEdgeHost();
  const certificates = await Promise.all(
    domains.map((domain) => probeCertificate({ domain, host: edgeHost })),
  );
  return Result.ok({
    edgeHost,
    probedAt: new Date().toISOString(),
    certificates,
  });
}
