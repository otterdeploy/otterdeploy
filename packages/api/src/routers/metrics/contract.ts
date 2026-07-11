/**
 * Resource metrics oRPC contract — recent CPU/memory/network samples for a
 * service node, fed from the `resource_metric` time series.
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "metrics";
const basePath = "/metrics";

const resourceIdField = zId(ID_PREFIX.resource);

const metricsQueryInput = z.object({
  resourceId: resourceIdField,
  // Look-back window in minutes (default 30, max 24h).
  windowMinutes: z.number().int().positive().max(1440).default(30),
});

const metricPointSchema = z.object({
  ts: z.date(),
  cpuPct: z.number(),
  memBytes: z.number(),
  memLimitBytes: z.number(),
  netRxBytes: z.number(),
  netTxBytes: z.number(),
});

const platformInput = z.object({
  windowMinutes: z.number().int().positive().max(1440).default(60),
});

// Project-wide aggregate. Max window = 7 days — the metric retention bound
// (hourly-cleanup prunes `resource_metric` after METRIC_RETENTION_DAYS = 7).
const projectAggregateInput = z.object({
  projectId: zId(ID_PREFIX.project),
  windowMinutes: z.number().int().positive().max(10080).default(30),
});

/** One aggregate bucket: per-container bucket-averages summed across every
 *  container in the project. Buckets where no container reported are omitted
 *  (a gap, not a fake zero); `containers` says how many reported, so a bucket
 *  where only half the fleet sampled reads as partial rather than as a dip. */
const aggregatePointSchema = z.object({
  ts: z.date(),
  /** Sum of Docker-style CPU percents (of one core) — can exceed 100. */
  cpuPct: z.number(),
  /** Summed working-set bytes across reporting containers. */
  memBytes: z.number(),
  /** Containers that reported at least one sample in this bucket. */
  containers: z.number(),
});

const queueSnapshotSchema = z.object({
  queue: z.string(),
  waiting: z.number(),
  active: z.number(),
  failed: z.number(),
  delayed: z.number(),
  completed: z.number(),
});

const seriesPointSchema = z.object({ ts: z.date(), value: z.number() });

export const metricsContract = {
  query: oc
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "GET" })
    .input(metricsQueryInput)
    .output(z.object({ points: z.array(metricPointSchema) })),

  // Project-wide CPU/memory aggregate: per-resource samples summed bucket-wise
  // across every container in the project. Backs the project metrics overview.
  projectAggregate: oc
    .meta({ path: `${basePath}/project/{projectId}`, tag, method: "GET" })
    .input(projectAggregateInput)
    .output(
      z.object({
        points: z.array(aggregatePointSchema),
        /** Bucket width the series was aggregated at. */
        bucketSeconds: z.number(),
      }),
    ),

  // Install-wide platform health: live queue backlog snapshot, queue
  // waiting/active over the window, and org deploy throughput. Queue metrics
  // are install-wide (shared across orgs); deploy throughput is org-scoped.
  platform: oc
    .meta({ path: `${basePath}/platform`, tag, method: "GET" })
    .input(platformInput)
    .output(
      z.object({
        queueSnapshot: z.array(queueSnapshotSchema),
        waitingSeries: z.array(seriesPointSchema),
        activeSeries: z.array(seriesPointSchema),
        deploy: z.object({
          succeeded: z.number(),
          failed: z.number(),
          inProgress: z.number(),
          total: z.number(),
          failureRate: z.number(),
        }),
      }),
    ),
};
