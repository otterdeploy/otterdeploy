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

export const metricsQueryInput = z.object({
  resourceId: resourceIdField,
  // Look-back window in minutes (default 30, max 24h).
  windowMinutes: z.number().int().positive().max(1440).default(30),
});

export const metricPointSchema = z.object({
  ts: z.date(),
  cpuPct: z.number(),
  memBytes: z.number(),
  memLimitBytes: z.number(),
  netRxBytes: z.number(),
  netTxBytes: z.number(),
});

export const metricsContract = {
  query: oc
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "GET" })
    .input(metricsQueryInput)
    .output(z.object({ points: z.array(metricPointSchema) })),
};
