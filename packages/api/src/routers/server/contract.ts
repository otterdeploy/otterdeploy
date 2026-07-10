import { oc } from "@orpc/contract";
import { server } from "@otterdeploy/db/schema";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { serverIdField } from "../project/contract/shared";
import { hostHealthSchema } from "../system/contract";
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
 * `docker node update --availability` for a swarm node, resolved from the
 * server row by hostname. Availability is a swarm scheduler concept, so the
 * procedure is honest about the two ways it can't apply: the instance isn't
 * running the swarm runtime (503) or no swarm node matches this server (409).
 */
const setAvailabilityInput = z.object({
  id: serverIdField,
  availability: z.enum(["active", "drain", "pause"]),
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

/**
 * Latest health snapshot per server (server_health_sample) — local host via
 * the 60s control-plane sampler, remote swarm nodes via the health agent.
 * `health` is null when the stored payload doesn't parse as the current
 * HostHealth shape (agent/control-plane version skew during updates) —
 * honest "no data" beats a crashed list. See docs/designs/server-health-agent.md.
 */
const serverHealthEntrySchema = z.object({
  serverId: serverIdField,
  hostname: z.string().nullable(),
  health: hostHealthSchema.nullable(),
  sampledAt: z.string(),
  receivedAt: z.string(),
  /** receivedAt older than 3× the sample interval — the reporter went quiet. */
  stale: z.boolean(),
});

const serverHealthInput = z.object({}).optional();

/**
 * Live swarm topology (`docker node ls`) enriched with each node's matching
 * server-row id — feeds the "Managers & quorum" card and the leader marker
 * on the servers table. `swarm: false` under the plain-docker runtime; the
 * UI shows its "requires Docker Swarm" state instead of an empty cluster.
 */
const swarmNodeSchema = z.object({
  /** Swarm node id. */
  id: z.string(),
  hostname: z.string(),
  role: z.enum(["manager", "worker"]),
  availability: z.string(),
  /** Node status.state — "ready", "down", … */
  state: z.string(),
  addr: z.string().nullable(),
  /** True on the current Raft leader. */
  leader: z.boolean(),
  /** ManagerStatus.Reachability — "reachable"/"unreachable"; null on workers. */
  reachability: z.string().nullable(),
  engineVersion: z.string().nullable(),
  /** Registered server row backing this node (hostname match); null when the
   *  node joined the swarm but was never registered — actions stay disabled. */
  serverId: serverIdField.nullable(),
});

const swarmNodesSchema = z.object({
  swarm: z.boolean(),
  nodes: z.array(swarmNodeSchema),
});

const swarmNodesInput = z.object({}).optional();

/**
 * `docker node promote` / `docker node demote` resolved from the server row
 * by hostname. Same honesty contract as setAvailability, plus two quorum
 * guards evaluated BEFORE docker is asked: never demote the last manager
 * (the swarm would be bricked) or the current Raft leader.
 */
const setRoleInput = z.object({
  id: serverIdField,
  role: z.enum(["manager", "worker"]),
});

/**
 * `docker node rm` — down-only, no force flag exposed. The server ROW is
 * deleted by the client through the normal server.delete flow afterwards.
 */
const removeNodeInput = z.object({
  id: serverIdField,
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
  setAvailability: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
      SWARM_UNAVAILABLE: {
        status: 503,
        message:
          "Node availability is managed by Docker Swarm — this instance runs the plain Docker runtime" as const,
      },
      NODE_NOT_FOUND: {
        status: 409,
        message: "No swarm node matches this server's hostname" as const,
      },
      UPDATE_FAILED: {
        status: 502,
        message: "Docker rejected the node availability update" as const,
      },
    })
    .meta({ path: `${basePath}/{id}/availability`, tag, method: "POST" })
    .input(setAvailabilityInput)
    .output(serverSchema),
  setRole: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
      SWARM_UNAVAILABLE: {
        status: 503,
        message:
          "Node roles are managed by Docker Swarm — this instance runs the plain Docker runtime" as const,
      },
      NODE_NOT_FOUND: {
        status: 409,
        message: "No swarm node matches this server's hostname" as const,
      },
      LAST_MANAGER: {
        status: 409,
        message:
          "Refusing to demote the last manager — the swarm would be left with no node able to accept management commands" as const,
      },
      LEADER: {
        status: 409,
        message:
          "Refusing to demote the swarm leader — promote another manager and let leadership move first" as const,
      },
      UPDATE_FAILED: {
        status: 502,
        message: "Docker rejected the node role update" as const,
      },
    })
    .meta({ path: `${basePath}/{id}/role`, tag, method: "POST" })
    .input(setRoleInput)
    .output(serverSchema),
  removeNode: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
      SWARM_UNAVAILABLE: {
        status: 503,
        message:
          "Swarm membership is managed by Docker Swarm — this instance runs the plain Docker runtime" as const,
      },
      NODE_NOT_FOUND: {
        status: 409,
        message: "No swarm node matches this server's hostname" as const,
      },
      NODE_NOT_DOWN: {
        status: 409,
        message:
          "Only nodes the swarm reports as down can be removed — drain the node and stop its daemon first" as const,
      },
      REMOVE_FAILED: {
        status: 502,
        message: "Docker rejected the node removal" as const,
      },
    })
    .meta({ path: `${basePath}/{id}/swarm-node`, tag, method: "DELETE" })
    .input(removeNodeInput)
    .output(z.object({ ok: z.boolean() })),
  swarmNodes: oc
    .errors({
      LIST_FAILED: {
        status: 502,
        message: "Couldn't list swarm nodes" as const,
      },
    })
    .meta({ path: `${basePath}/swarm-nodes`, tag, method: "GET" })
    .input(swarmNodesInput)
    .output(swarmNodesSchema),
  stats: oc
    .meta({ path: `${basePath}/stats`, tag, method: "GET" })
    .input(serverStatsInput)
    .output(serverStatsSchema),
  health: oc
    .meta({ path: `${basePath}/health`, tag, method: "GET" })
    .input(serverHealthInput)
    .output(z.array(serverHealthEntrySchema)),
  joinTokens: oc
    .meta({ path: `${basePath}/join-tokens`, tag, method: "GET" })
    .input(joinTokensInput)
    .output(swarmJoinTokensSchema),
};
