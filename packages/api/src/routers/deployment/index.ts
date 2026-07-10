/**
 * Deployment router — cross-resource deployment reads. Per-resource
 * deployment history lives under `project.resource.deployments.*`
 * (see ../project/router-resource-deployments); this namespace holds the
 * project-wide views.
 */
import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";
import { listProjectDeployments } from "./list-by-project";

export const deploymentRouter = {
  listByProject: orgScopedProcedure.deployment.listByProject.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await listProjectDeployments({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        status: input.status,
        since: input.since ? new Date(input.since) : undefined,
        limit: input.limit,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
