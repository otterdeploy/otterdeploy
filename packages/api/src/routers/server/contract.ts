import { eventIterator, oc } from "@orpc/contract";
import { server } from "@otterdeploy/db/schema";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

// From the pure parse module, not the collector: the contract is imported
// (type-only) by the web app, and it has no business pulling node:fs in.
import { UNIT_ACTIVE_STATES, UNIT_SUB_STATES } from "../../system-health/systemd-parse";
import { serverIdField } from "../project/contract/shared";
import { hostHealthSchema } from "../system/contract";

const sshKeyIdField = zId(ID_PREFIX.sshKey);
const nodeEnrollmentIdField = zId(ID_PREFIX.nodeEnrollment);
const tag = "server";
const basePath = "/servers";

export const serverSchema = createSelectSchema(server).extend({
  id: serverIdField,
  // labels is a string[] in DB, jsonb in pg, drizzle-zod widens it; pin it.
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
 * SSH-provision a fresh host into the swarm (docs/designs/server-onboarding.md).
 * Auth is either a managed key (`sshKeyId`) or a one-time `password`; the
 * handler rejects neither/both. Returns the row in `provisioning` state. The
 * live output streams over `provisionLogs`.
 */
const provisionServerInput = z.object({
  id: serverIdField.optional(),
  name: z.string().min(1),
  host: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPort: z.number().int().min(1).max(65535).default(22),
  role: z.enum(["manager", "worker"]).default("worker"),
  /** Managed key to authenticate with (must be a generated key we hold). */
  sshKeyId: sshKeyIdField.optional(),
  /** One-time bootstrap password, used for this run only, never stored. */
  password: z.string().min(1).optional(),
  /** Dedicated build node. Labelled `otterdeploy.role=build` in the swarm. */
  buildServer: z.boolean().default(false),
  /** WireGuard mesh to join before the swarm join. `none` = public join. */
  meshProvider: z.enum(["none", "tailscale", "netbird"]).default("none"),
  /** Self-hosted NetBird management URL; omit for the hosted service. */
  meshManagementUrl: z.string().optional(),
  /** Tailnet auth key / NetBird setup key: one-time, never stored. */
  meshAuthKey: z.string().optional(),
  /** Cloudflare Tunnel connector token: installs cloudflared, never stored. */
  cloudflareToken: z.string().optional(),
});

const provisionLogsInput = z.object({ id: serverIdField });

const provisionLineSchema = z.object({
  line: z.string(),
  ts: z.string(),
});

const retryProvisionInput = z.object({ id: serverIdField });

/** od-5j8.11 drift remediation. */
const reapplyFirewallInput = z.object({ id: serverIdField });

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
 * from each task's `Spec.Resources.Reservations`. Falls back to 0 when
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

const enrollmentRoleField = z.enum(["worker", "manager"]);
// Step-up re-authentication, same shape as the terminal's (routers/terminal
// /contract.ts): whichever credential the account actually has. Enrollment
// used to demand TOTP unconditionally, so an operator without an authenticator
// was shown a code field, told nothing, and could never enroll a node.
// `verifyStepUpCredential` picks the right one instead.
const stepUpFields = {
  role: enrollmentRoleField,
  /** Required when the account has an authenticator app enabled. */
  totpCode: z
    .string()
    .regex(/^\d{6}(\d{2})?$/, "Enter the current authenticator code.")
    .optional(),
  /** Required otherwise. */
  password: z.string().min(1, "Enter your password.").optional(),
  managerConfirmation: z.string().optional(),
};
const enrollmentErrors = {
  TWO_FACTOR_CODE_REQUIRED: {
    status: 400,
    message: "Enter the current authenticator code." as const,
  },
  PASSWORD_REQUIRED: {
    status: 400,
    message: "Enter your password." as const,
  },
  INVALID_STEP_UP: {
    status: 403,
    message: "That code or password is incorrect." as const,
  },
  MANAGER_CONFIRMATION_REQUIRED: {
    status: 400,
    message: 'Type "ENROLL MANAGER" to authorize manager enrollment.' as const,
  },
  SWARM_UNAVAILABLE: {
    status: 409,
    message: "Initialize Docker Swarm before creating node enrollment." as const,
  },
};
const createEnrollmentInput = z.object({
  ...stepUpFields,
  ttlMinutes: z.number().int().min(5).max(30).default(10),
});
const enrollmentSchema = z.object({
  id: nodeEnrollmentIdField,
  role: enrollmentRoleField,
  status: z.enum(["active", "expired", "redeemed", "completed", "revoked"]),
  expiresAt: z.string(),
  redeemedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
const listEnrollmentsInput = z.object({}).optional();
const revokeEnrollmentInput = z.object({ id: nodeEnrollmentIdField });
const rotateJoinCredentialInput = z.object(stepUpFields);

/**
 * Latest health snapshot per server (server_health_sample): local host via
 * the 60s control-plane sampler, remote swarm nodes via the health agent.
 * `health` is null when the stored payload doesn't parse as the current
 * HostHealth shape (agent/control-plane version skew during updates).
 * Honest "no data" beats a crashed list. See docs/designs/server-health-agent.md.
 */
const serverHealthEntrySchema = z.object({
  serverId: serverIdField,
  hostname: z.string().nullable(),
  health: hostHealthSchema.nullable(),
  sampledAt: z.string(),
  receivedAt: z.string(),
  /** receivedAt older than 3× the sample interval: the reporter went quiet. */
  stale: z.boolean(),
});

const serverHealthInput = z.object({}).optional();

/**
 * Per-node metric HISTORY (server_metric): the append-only series written
 * beside every health snapshot. Max window = 7 days, the metric retention
 * bound the hourly cleanup enforces, same as the container series.
 */
const serverMetricsInput = z.object({
  id: serverIdField,
  windowMinutes: z.number().int().positive().max(10080).default(60),
});

/** Every series column is nullable: a node whose reporter could not read a
 *  section (no procfs, no CPU delta yet) charts a gap, never a fake zero. */
const serverMetricPointSchema = z.object({
  ts: z.date(),
  /** Busy percent of the whole machine, 0–100 (not core-summed). */
  cpuPct: z.number().nullable(),
  cpuUserPct: z.number().nullable(),
  cpuSystemPct: z.number().nullable(),
  cpuIowaitPct: z.number().nullable(),
  cpuStealPct: z.number().nullable(),
  /** Highest single report inside the bucket; equals cpuPct at raw resolution. */
  cpuPctMax: z.number().nullable(),
  memUsedPct: z.number(),
  memAvailableBytes: z.number(),
  memTotalBytes: z.number(),
  memCachedBytes: z.number().nullable(),
  memBuffersBytes: z.number().nullable(),
  zfsArcBytes: z.number().nullable(),
  swapUsedPct: z.number().nullable(),
  diskUsedPct: z.number().nullable(),
  diskFreeBytes: z.number().nullable(),
  /** Summed across every whole block device on the node. */
  diskReadBytesPerSec: z.number().nullable(),
  diskWriteBytesPerSec: z.number().nullable(),
  loadAvg1: z.number().nullable(),
  loadAvg5: z.number().nullable(),
  loadAvg15: z.number().nullable(),
  /** Summed across every interface except loopback. */
  netRxBytesPerSec: z.number().nullable(),
  netTxBytesPerSec: z.number().nullable(),
});

/**
 * Latest per-unit systemd status for ONE server (server_unit): docker, sshd,
 * the firewall, the log shipper. A status surface, not a series, so there is
 * exactly one row per unit and no time range to ask for. Units a host stops
 * reporting age out of the table on their own; `stale` flags the ones whose
 * host has gone quiet in the meantime.
 */
const serverUnitEntrySchema = z.object({
  unitName: z.string(),
  activeState: z.enum(UNIT_ACTIVE_STATES),
  subState: z.enum(UNIT_SUB_STATES),
  /** Percent of one host's worth of CPU, derived across two reports. */
  cpuPct: z.number(),
  /** Null when the unit has no memory accounting on that host. */
  memBytes: z.number().nullable(),
  memPeakBytes: z.number().nullable(),
  restartCount: z.number().int(),
  activeEnterAt: z.string().nullable(),
  updatedAt: z.string(),
  /** Last report older than 3x the sample interval: the host went quiet. */
  stale: z.boolean(),
});

const serverUnitsInput = z.object({ id: serverIdField });

/**
 * Live swarm topology (`docker node ls`) enriched with each node's matching
 * server-row id: feeds the "Managers & quorum" card and the leader marker
 * on the servers table. `swarm: false` under the plain-docker runtime; the
 * UI shows its "requires Docker Swarm" state instead of an empty cluster.
 */
const swarmNodeSchema = z.object({
  /** Swarm node id. */
  id: z.string(),
  hostname: z.string(),
  role: z.enum(["manager", "worker"]),
  availability: z.string(),
  /** Node status.state: "ready", "down", … */
  state: z.string(),
  addr: z.string().nullable(),
  /** True on the current Raft leader. */
  leader: z.boolean(),
  /** ManagerStatus.Reachability: "reachable"/"unreachable"; null on workers. */
  reachability: z.string().nullable(),
  engineVersion: z.string().nullable(),
  /** Registered server row backing this node (hostname match); null when the
   *  node joined the swarm but was never registered. Actions stay disabled. */
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
 * `docker node rm`: down-only, no force flag exposed. The server ROW is
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
    .output(
      z.object({
        ok: z.boolean(),
        /** Resources that were pinned to this server and are now schedulable
         *  again. Reported because removing a machine silently changes where
         *  other things are allowed to run, and that shouldn't be invisible. */
        unpinnedResources: z.number().int().nonnegative(),
      }),
    ),
  setAvailability: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
      SWARM_UNAVAILABLE: {
        status: 503,
        message:
          "Node availability is managed by Docker Swarm. This instance runs the plain Docker runtime" as const,
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
          "Node roles are managed by Docker Swarm. This instance runs the plain Docker runtime" as const,
      },
      NODE_NOT_FOUND: {
        status: 409,
        message: "No swarm node matches this server's hostname" as const,
      },
      LAST_MANAGER: {
        status: 409,
        message:
          "Refusing to demote the last manager: the swarm would be left with no node able to accept management commands" as const,
      },
      LEADER: {
        status: 409,
        message:
          "Refusing to demote the swarm leader: promote another manager and let leadership move first" as const,
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
          "Swarm membership is managed by Docker Swarm. This instance runs the plain Docker runtime" as const,
      },
      NODE_NOT_FOUND: {
        status: 409,
        message: "No swarm node matches this server's hostname" as const,
      },
      NODE_NOT_DOWN: {
        status: 409,
        message:
          "Only nodes the swarm reports as down can be removed. Drain the node and stop its daemon first" as const,
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
  metrics: oc
    .meta({ path: `${basePath}/{id}/metrics`, tag, method: "GET" })
    .input(serverMetricsInput)
    .output(
      z.object({
        points: z.array(serverMetricPointSchema),
        /** Width of each point. Feeds the chart's gap detection and its
         *  "one point per N minutes" caption. */
        bucketSeconds: z.number(),
      }),
    ),
  units: oc
    .meta({ path: `${basePath}/{id}/units`, tag, method: "GET" })
    .input(serverUnitsInput)
    .output(z.array(serverUnitEntrySchema)),
  enrollments: oc
    .meta({ path: `${basePath}/enrollments`, tag, method: "GET" })
    .input(listEnrollmentsInput)
    .output(z.array(enrollmentSchema)),
  createEnrollment: oc
    .errors(enrollmentErrors)
    .meta({ path: `${basePath}/enrollments`, tag, method: "POST" })
    .input(createEnrollmentInput)
    .output(
      z.object({
        id: nodeEnrollmentIdField,
        role: enrollmentRoleField,
        credential: z.string(),
        expiresAt: z.string(),
      }),
    ),
  revokeEnrollment: oc
    .errors({ NOT_FOUND: { status: 404, message: "Enrollment not found" as const } })
    .meta({ path: `${basePath}/enrollments/revoke`, tag, method: "POST" })
    .input(revokeEnrollmentInput)
    .output(z.object({ revoked: z.literal(true) })),
  rotateJoinCredential: oc
    .errors(enrollmentErrors)
    .meta({ path: `${basePath}/enrollments/rotate`, tag, method: "POST" })
    .input(rotateJoinCredentialInput)
    .output(z.object({ rotated: z.literal(true) })),
  provision: oc
    .errors({
      CONFLICT: {
        status: 409,
        message: "Server with this host is already registered" as const,
      },
      BAD_REQUEST: {
        status: 400,
        message: "Provide exactly one SSH credential: a managed key or a password" as const,
      },
    })
    .meta({ path: `${basePath}/provision`, tag, method: "POST" })
    .input(provisionServerInput)
    .output(serverSchema),
  provisionLogs: oc
    .meta({ path: `${basePath}/{id}/provision-logs`, tag, method: "GET" })
    .input(provisionLogsInput)
    .output(eventIterator(provisionLineSchema)),
  retryProvision: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
      NOT_FAILED: {
        status: 409,
        message: "Only a failed provisioning run can be retried" as const,
      },
      MISSING_CREDENTIAL: {
        status: 409,
        message:
          "This server was provisioned with a one-time password. Re-add it to retry (the password isn't stored)" as const,
      },
    })
    .meta({ path: `${basePath}/{id}/retry-provision`, tag, method: "POST" })
    .input(retryProvisionInput)
    .output(serverSchema),
  /**
   * od-5j8.11: re-apply the host firewall + native CrowdSec bouncer to an
   * already-joined node. Enqueues the same provisioning job in
   * firewall-only mode; the operator polls provisionLogs / server.get to
   * watch firewallStatus flip off "unknown"/"failed".
   */
  reapplyFirewall: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Server not found" as const },
      MISSING_CREDENTIAL: {
        status: 409,
        message:
          "This server has no stored managed SSH key. Re-add it with a managed key to enable remediation" as const,
      },
    })
    .meta({ path: `${basePath}/{id}/reapply-firewall`, tag, method: "POST" })
    .input(reapplyFirewallInput)
    .output(serverSchema),
};
