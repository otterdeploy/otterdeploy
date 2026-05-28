/**
 * Proxy-route orchestration. Surfaces the Caddy proxy routes scoped to a
 * project so the dashboard can render the routing table.
 */

import { Result } from "better-result";

import { listProxyRoutesByProject } from "../../caddy/queries";

import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";
import { type ProxyRoute } from "./views";
import type { ProjectRef } from "../scopes";

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
