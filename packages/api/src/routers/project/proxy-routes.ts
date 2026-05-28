/**
 * Proxy-route orchestration. Surfaces the Caddy proxy routes scoped to a
 * project so the dashboard can render the routing table.
 */

import { Result } from "better-result";

import { type Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { listProxyRoutesByProject } from "../../caddy/queries";

import { ProjectNotFoundError, type ProjectId } from "./errors";
import { getProjectInOrg } from "./queries";
import { type ProxyRoute } from "./views";

type OrgId = Id<typeof ID_PREFIX.organization>;

interface ProjectRef {
  projectId: ProjectId;
  organizationId: OrgId;
}

export async function listProjectProxyRoutes(
  input: ProjectRef,
): Promise<Result<ProxyRoute[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const records = await listProxyRoutesByProject(input.projectId);
  return Result.ok(records);
}
