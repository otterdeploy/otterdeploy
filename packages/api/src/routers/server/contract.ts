import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { server } from "@otterstack/db/schema";
import { ID_PREFIX, zId } from "@otterstack/shared/id";

const tag = "server";
const basePath = "/servers";

export const serverSchema = createSelectSchema(server).extend({
  id: zId(ID_PREFIX.server),
  // labels is a string[] in DB, jsonb in pg — drizzle-zod widens it; pin it.
  labels: z.array(z.string()),
});

export const listServersInput = z.void();

export const getServerInput = z.object({
  id: zId(ID_PREFIX.server),
});

export const createServerInput = z.object({
  /** Optional client-supplied id for optimistic UI. */
  id: zId(ID_PREFIX.server).optional(),
  name: z.string().min(1),
  host: z.string().min(1),
  region: z.string().min(1),
  role: z.enum(["manager", "worker"]).default("worker"),
  cpuTotal: z.number().int().min(1),
  memTotalGb: z.number().int().min(1),
  diskTotalGb: z.number().int().min(1).optional(),
  diskUnit: z.string().optional(),
  daemonVersion: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

export const deleteServerInput = z.object({
  id: zId(ID_PREFIX.server),
});

export const serverContract = {
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(listServersInput)
    .output(z.array(serverSchema)),
  get: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "GET" })
    .input(getServerInput)
    .output(serverSchema),
  create: oc
    .errors({
      CONFLICT: {
        status: 409,
        message: "Server with this host is already registered" as const,
      },
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createServerInput)
    .output(serverSchema),
  delete: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "DELETE" })
    .input(deleteServerInput)
    .output(z.object({ ok: z.boolean() })),
};
