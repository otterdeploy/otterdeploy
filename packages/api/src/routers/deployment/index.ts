/**
 * Deployment router: cross-resource deployment reads. Per-resource
 * deployment history lives under `project.resource.deployments.*`
 * (see ../project/router-resource-deployments); this namespace holds the
 * project-wide views.
 */
import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";
import { getDeployActivity } from "./activity";
import { cancelDeployment } from "./cancel";
import { listProjectDeployments } from "./list-by-project";

export const deploymentRouter = {
  activity: orgScopedProcedure.deployment.activity.handler(async ({ input, context }) =>
    getDeployActivity({
      organizationId: context.activeOrganizationId,
      limit: input.limit,
    }),
  ),

  cancel: orgScopedProcedure.deployment.cancel.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "deployment", id: input.deploymentId } });
    const result = await cancelDeployment({
      deploymentId: input.deploymentId,
      organizationId: context.activeOrganizationId,
      // Recorded on the row so history says who stopped it, not just that it
      // stopped.
      cancelledBy: context.session?.user.email ?? context.session?.user.id ?? "an operator",
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        DeploymentNotFoundError: () => errors.NOT_FOUND(),
        DeploymentNotCancellableError: () => errors.CONFLICT(),
      });
    }
    return result.value;
  }),

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
