import { orgScopedProcedure } from "../..";
import {
  currentQueueSnapshot,
  queryDeployThroughput,
  queryPlatformSeries,
} from "../../metrics/platform";
import { queryResourceMetrics } from "../../metrics/query";
import {
  chooseBucketSeconds,
  mergeAggregateBuckets,
  queryProjectAggregateBuckets,
} from "./project-aggregate";

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

  // Project-wide CPU/memory series: per-container bucket averages (SQL)
  // summed per bucket (mergeAggregateBuckets). Buckets nobody sampled are
  // omitted, not zero-filled — the chart shows a gap, not a fake dip.
  projectAggregate: orgScopedProcedure.metrics.projectAggregate.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const bucketSeconds = chooseBucketSeconds(input.windowMinutes);
      const since = new Date(Date.now() - input.windowMinutes * 60 * 1000);
      const rows = await queryProjectAggregateBuckets({
        organizationId: context.activeOrganizationId,
        projectId: input.projectId,
        since,
        bucketSeconds,
      });
      return { points: mergeAggregateBuckets(rows, bucketSeconds), bucketSeconds };
    },
  ),

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
