import { oc } from "@orpc/contract";
import * as z from "zod";

import { ServerSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, SuccessSchema } from "../shared";

export const serverContract = {
  register: oc
    .route(route("POST", "/servers"))
    .input(
      z.object({
        organizationId: IdSchema,
        name: z.string().min(1).max(128),
        ipAddress: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(22),
        role: z.enum(["manager", "worker"]).default("worker"),
      }),
    )
    .output(ServerSchema),
  list: oc
    .route(route("GET", "/servers"))
    .input(
      z.object({
        organizationId: IdSchema,
      }),
    )
    .output(z.array(ServerSchema)),
  test: oc
    .route(route("POST", "/servers/{serverId}/test"))
    .input(
      z.object({
        serverId: IdSchema,
      }),
    )
    .output(
      z.object({
        serverId: IdSchema,
        status: z.enum(["healthy", "degraded", "offline"]),
        roundTripMs: z.number().int().nullable(),
      }),
    ),
  remove: oc
    .route(route("DELETE", "/servers/{serverId}"))
    .input(
      z.object({
        serverId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};
