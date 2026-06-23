/**
 * Resource metrics oRPC contract — recent CPU/memory/network samples for a
 * service node, fed from the `resource_metric` time series.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

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
