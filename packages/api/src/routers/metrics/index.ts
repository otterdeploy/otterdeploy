import { orgScopedProcedure } from "../..";
import { queryResourceMetrics } from "../../metrics/query";

export const metricsRouter = {
  query: orgScopedProcedure.metrics.query.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      const since = new Date(Date.now() - input.windowMinutes * 60 * 1000);
      const points = await queryResourceMetrics({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        since,
      });
      return { points };
    },
  ),
};
