
import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { server } from "@otterdeploy/db/schema";
import { serverIdField } from "../project/contract/shared";
const tag = "server";
const basePath = "/servers";

export const serverSchema = createSelectSchema(server).extend({
  id: serverIdField,
  // labels is a string[] in DB, jsonb in pg — drizzle-zod widens it; pin it.
  labels: z.array(z.string()),
});

// GET input must be object/any/unknown for the OpenAPI generator; optional
// empty object keeps "no input" valid.
const listServersInput = z.object({}).optional();

const getServerInput = z.object({
  id: serverIdField,
});

const createServerInput = z.object({
  /** Optional client-supplied id for optimistic UI. */
  id: serverIdField.optional(),
  name: z.string().min(1),
  /**
   * Operator-reported OS hostname. The join-command flow collects this
   * separately from `name` so the friendly label and the underlying machine
   * stay distinct.
   */
  hostname: z.string().optional(),
  host: z.string().min(1),
  region: z.string().min(1).optional(),
  role: z.enum(["manager", "worker"]).default("worker"),
  // Capacity is daemon-reported. The join-command flow registers the node
  // before the daemon answers, so these default to 0 and get populated when
  // the agent self-registers.
  cpuTotal: z.number().int().min(0).default(0),
  memTotalGb: z.number().int().min(0).default(0),
  diskTotalGb: z.number().int().min(1).optional(),
  diskUnit: z.string().optional(),
  daemonVersion: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

const deleteServerInput = z.object({
  id: serverIdField,
});

/**
 * Per-node live aggregates surfaced on the servers page rows. CPU is in
 * vCPU units (NanoCPUs / 1e9); memory is in GiB. Reservation values come
 * from each task's `Spec.Resources.Reservations` — falls back to 0 when
 * no reservation is set, which is honest about under-specified services.
 */
const serverNodeStatsSchema = z.object({
  serverId: serverIdField,
  tasksRunning: z.number().int().min(0),
  cpuAllocatedVcpu: z.number().min(0),
  memoryAllocatedGb: z.number().min(0),
  /** Project slugs with at least one task placed on this node. */
  projects: z.array(z.string()),
});

const serverClusterStatsSchema = z.object({
  tasksRunning: z.number().int().min(0),
  /** Per-project running-task count + display name, used by the project
   *  filter pills on the servers page header. */
  projects: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      tasksRunning: z.number().int().min(0),
    }),
  ),
});

const serverStatsSchema = z.object({
  perServer: z.array(serverNodeStatsSchema),
  cluster: serverClusterStatsSchema,
});

const serverStatsInput = z.object({}).optional();

/**
 * Swarm join tokens + the manager address operators paste into
 * `docker swarm join`. Sourced from `docker swarm inspect` + `docker info`
 * — "—" sentinels when the daemon hasn't been initialized as a swarm yet.
 */
const swarmJoinTokensSchema = z.object({
  worker: z.string(),
  manager: z.string(),
  managerAddr: z.string(),
});

const joinTokensInput = z.object({}).optional();

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
  stats: oc
    .meta({ path: `${basePath}/stats`, tag, method: "GET" })
    .input(serverStatsInput)
    .output(serverStatsSchema),
  joinTokens: oc
    .meta({ path: `${basePath}/join-tokens`, tag, method: "GET" })
    .input(joinTokensInput)
    .output(swarmJoinTokensSchema),
};
