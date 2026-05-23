/**
 * Proxy-route orchestration. Surfaces the Caddy proxy routes scoped to a
 * project so the dashboard can render the routing table.
 */

import { Result } from "better-result";

import { listProxyRoutesByProject } from "../../caddy/queries";

import { ProjectNotFoundError, type ProjectId } from "./errors";
import { getProjectInOrg } from "./queries";
import { type ProxyRouteView } from "./views";

type ProjectRef = {
  projectId: ProjectId;
  organizationId: string;
};

export async function listProjectProxyRoutes(
  input: ProjectRef,
): Promise<Result<ProxyRouteView[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const records = await listProxyRoutesByProject(input.projectId);

  return Result.ok(
    records.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      resourceId: r.resourceId,
      type: r.type,
      domain: r.domain,
      upstreamHost: r.upstreamHost,
      upstreamPort: r.upstreamPort,
      protocol: r.protocol,
      layer4Alpn: r.layer4Alpn,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}
