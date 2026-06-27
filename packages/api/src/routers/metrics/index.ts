import { orgScopedProcedure } from "../..";
import {
  currentQueueSnapshot,
  queryDeployThroughput,
  queryPlatformSeries,
} from "../../metrics/platform";
import { queryResourceMetrics } from "../../metrics/query";

export const metricsRouter = {
  query: orgScopedProcedure.metrics.query.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "resource", id: input.resourceId } });
    const since = new Date(Date.now() - input.windowMinutes * 60 * 1000);
    const points = await queryResourceMetrics({
      organizationId: context.activeOrganizationId,
      resourceId: input.resourceId,
      since,
    });
    return { points };
  }),

  platform: orgScopedProcedure.metrics.platform.handler(async ({ input, context }) => {
    const since = new Date(Date.now() - input.windowMinutes * 60 * 1000);
    const [queueSnapshot, waitingSeries, activeSeries, deploy] = await Promise.all([
      currentQueueSnapshot(),
      queryPlatformSeries("queue.waiting", since),
      queryPlatformSeries("queue.active", since),
      queryDeployThroughput(context.activeOrganizationId, since),
    ]);
    return { queueSnapshot, waitingSeries, activeSeries, deploy };
  }),
};
