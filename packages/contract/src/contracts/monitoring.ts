import { oc } from "@orpc/contract";
import * as z from "zod";

import { DeploymentLogSchema, MetricPointSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, PaginatedInputSchema, createPaginatedOutputSchema } from "../shared";

export const monitoringContract = {
  getMetrics: oc
    .route(route("GET", "/monitoring/metrics"))
    .input(
      z.object({
        resourceId: IdSchema,
        metric: z.enum(["cpu", "memory", "network_in", "network_out", "disk"]),
        from: z.iso.datetime(),
        to: z.iso.datetime(),
      }),
    )
    .output(
      z.object({
        resourceId: IdSchema,
        metric: z.string(),
        points: z.array(MetricPointSchema),
      }),
    ),
  getLogs: oc
    .route(route("GET", "/monitoring/logs"))
    .input(
      PaginatedInputSchema.extend({
        resourceId: IdSchema,
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema)),
  streamLogs: oc
    .route(route("GET", "/monitoring/logs/stream"))
    .input(
      z.object({
        resourceId: IdSchema,
        cursor: z.string().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema)),
};
