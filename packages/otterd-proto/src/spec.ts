/**
 * ServiceSpec: Swarm ServiceSpec semantics with otterd's defaults,
 * mirror of `spec.rs`. `normalizeServiceSpec` and `validateServiceSpec` must
 * agree with the Rust functions on every case in `fixtures/spec-normalize.json`.
 *
 * Wire rule for optional fields: a Rust field skipped when empty is `.optional()`
 * here; a Rust field with a serde default that is always serialized carries the
 * same `.default()` here, so canonical fixtures round-trip unchanged.
 */
import * as z from "zod";

import { nodeRole } from "./identity";
import { u16, u32, u53, wireId } from "./primitives";

export const DEFAULT_FAILOVER_DELAY_MS = 60_000;
export const MIN_FAILOVER_DELAY_MS = 30_000;
export const DEFAULT_MEMORY_RESERVATION_BYTES = 64 * 1024 * 1024;
export const DEFAULT_NANO_CPU_RESERVATION = 50_000_000;
export const DEFAULT_STOP_GRACE_MS = 10_000;

export const serviceMode = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("replicated"), replicas: u32 }),
  z.strictObject({ kind: z.literal("global") }),
  z.strictObject({ kind: z.literal("job"), maxConcurrent: u32, completions: u32 }),
]);
export type ServiceMode = z.infer<typeof serviceMode>;

export const imageSpec = z.strictObject({ reference: z.string(), digest: z.string().optional() });

export const envValue = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({ kind: z.literal("secret"), secretRef: z.string() }),
]);
export const envVar = z.strictObject({ name: z.string(), value: envValue });

export const checkRef = z.strictObject({ id: wireId, revision: u53 });

export const containerSpec = z.strictObject({
  image: imageSpec,
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.array(envVar).optional(),
  user: z.string().optional(),
  workdir: z.string().optional(),
  hostname: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  init: z.boolean().optional(),
  tty: z.boolean().optional(),
  readOnlyRootfs: z.boolean().optional(),
  stopSignal: z.string().optional(),
  stopGraceMs: u53.default(DEFAULT_STOP_GRACE_MS),
  capAdd: z.array(z.string()).optional(),
  capDrop: z.array(z.string()).optional(),
  sysctls: z.record(z.string(), z.string()).optional(),
  imageHealthcheck: z.enum(["inherit", "disable"]).default("inherit"),
  checks: z.array(checkRef).optional(),
});

export const mountKind = z.enum(["volume", "bind", "tmpfs"]);
export const mount = z.strictObject({
  kind: mountKind,
  source: z.string().optional(),
  target: z.string(),
  readOnly: z.boolean().optional(),
  dataIdentity: wireId.optional(),
  tmpfsSizeBytes: u53.optional(),
});
export type Mount = z.infer<typeof mount>;

export const RESERVATION_KINDS = ["cpu", "memory"] as const;
export const reservationKind = z.enum(RESERVATION_KINDS);

export const resources = z.strictObject({
  limits: z
    .strictObject({ nanoCpus: u53.optional(), memoryBytes: u53.optional(), pids: u32.optional() })
    .default({}),
  reservations: z
    .strictObject({ nanoCpus: u53.optional(), memoryBytes: u53.optional() })
    .default({}),
  defaulted: z.array(reservationKind).optional(),
});

export const restartPolicy = z.strictObject({
  condition: z.enum(["any", "on-failure", "none"]).default("any"),
  delayMs: u53.default(5_000),
  maxAttempts: u32.optional(),
  windowMs: u53.default(0),
});

export const placement = z.strictObject({
  constraints: z
    .array(z.strictObject({ key: z.string(), op: z.enum(["eq", "neq"]), value: z.string() }))
    .optional(),
  architectures: z.array(z.string()).optional(),
  roles: z.array(nodeRole).optional(),
  nodes: z.array(wireId).optional(),
  preferences: z.array(z.strictObject({ label: z.string() })).optional(),
  maxReplicasPerNode: u32.optional(),
});

export const taskSpec = z.strictObject({
  container: containerSpec,
  mounts: z.array(mount).optional(),
  resources: resources.default({ limits: {}, reservations: {} }),
  restart: restartPolicy.default({ condition: "any", delayMs: 5_000, windowMs: 0 }),
  placement: placement.default({}),
});
export type TaskSpec = z.infer<typeof taskSpec>;

const failureAction = z.enum(["pause", "continue", "rollback"]);
const UPDATE_ORDERS = ["stop-first", "start-first"] as const;
export const updateOrder = z.enum(UPDATE_ORDERS);
export type UpdateOrder = z.infer<typeof updateOrder>;

export const updateConfig = z.strictObject({
  parallelism: u32,
  delayMs: u53,
  monitorMs: u53,
  maxFailureRatioPermille: u16,
  failureAction,
  order: updateOrder,
});
export type UpdateConfig = z.infer<typeof updateConfig>;

export const updateConfigInput = z.strictObject({
  parallelism: u32.optional(),
  delayMs: u53.optional(),
  monitorMs: u53.optional(),
  maxFailureRatioPermille: u16.optional(),
  failureAction: failureAction.optional(),
  order: updateOrder.optional(),
});
export type UpdateConfigInput = z.infer<typeof updateConfigInput>;

export const portProtocol = z.enum(["tcp", "udp"]);
export const endpointSpec = z.strictObject({
  mode: z.enum(["vip", "dnsrr"]).default("vip"),
  ports: z
    .array(
      z.strictObject({
        name: z.string().optional(),
        protocol: portProtocol.default("tcp"),
        targetPort: u16,
        publishedPort: u16.optional(),
        publish: z.enum(["internal", "host"]).default("internal"),
      }),
    )
    .optional(),
  aliases: z.array(z.string()).optional(),
  scopes: z.array(wireId).optional(),
});
export type EndpointSpec = z.infer<typeof endpointSpec>;

const failoverPolicy = z.enum(["stay", "reschedule"]);
export type FailoverPolicy = z.infer<typeof failoverPolicy>;
export const disconnectAction = z.enum(["continue-existing", "stop"]);
export type DisconnectAction = z.infer<typeof disconnectAction>;
const concurrentSafe = z.strictObject({ revision: u53, justification: z.string() });

export const LIFECYCLE_FIELDS = [
  "failover-policy",
  "failover-delay",
  "exclusive",
  "disconnect-action",
  "update-order",
  "rollback-order",
] as const;
export type LifecycleField = (typeof LIFECYCLE_FIELDS)[number];

export const lifecycle = z.strictObject({
  failover: z.strictObject({ policy: failoverPolicy, delayMs: u53 }),
  exclusive: z.boolean(),
  disconnectAction,
  concurrencyGroup: wireId.optional(),
  concurrentSafe: concurrentSafe.optional(),
  basis: z.enum(["mounted", "mount-free", "job"]),
  overrides: z.array(z.enum(LIFECYCLE_FIELDS)).optional(),
});

export const lifecycleInput = z.strictObject({
  failoverPolicy: failoverPolicy.optional(),
  failoverDelayMs: u53.optional(),
  exclusive: z.boolean().optional(),
  disconnectAction: disconnectAction.optional(),
  concurrencyGroup: wireId.optional(),
  concurrentSafe: concurrentSafe.optional(),
});

/** The normalized, fully explicit specification stored by the CP and sent to nodes. */
export const serviceSpec = z.strictObject({
  schema: u16,
  resourceId: wireId,
  mode: serviceMode,
  task: taskSpec,
  update: updateConfig,
  rollback: updateConfig,
  endpoint: endpointSpec,
  lifecycle,
});
export type ServiceSpec = z.infer<typeof serviceSpec>;

/** A specification as entered (API, manifest, Compose normalization). */
export const serviceSpecInput = z.strictObject({
  resourceId: wireId,
  mode: serviceMode.default({ kind: "replicated", replicas: 1 }),
  task: taskSpec,
  update: updateConfigInput.default({}),
  rollback: updateConfigInput.default({}),
  endpoint: endpointSpec.default({ mode: "vip" }),
  lifecycle: lifecycleInput.default({}),
});
export type ServiceSpecInput = z.infer<typeof serviceSpecInput>;

export const SPEC_ISSUE_CODES = [
  "SCHEMA_UNSUPPORTED",
  "EXCLUSIVE_REQUIRES_STOP_FIRST",
  "HOST_PORT_REQUIRES_STOP_FIRST",
  "FAILOVER_DELAY_BELOW_MINIMUM",
  "SHARED_WRITABLE_MOUNT",
  "JOB_REQUIRES_EXCLUSIVE",
  "MOUNT_SOURCE_REQUIRED",
  "TMPFS_HAS_SOURCE",
  "DUPLICATE_MOUNT_TARGET",
  "FAILURE_RATIO_OUT_OF_RANGE",
  "IMAGE_DIGEST_INVALID",
  "RESCHEDULE_LEAVES_DATA_BEHIND",
  "DNSRR_CLIENT_LIMITATIONS",
] as const;
export type SpecIssueCode = (typeof SPEC_ISSUE_CODES)[number];

export const specIssue = z.strictObject({
  code: z.enum(SPEC_ISSUE_CODES),
  severity: z.enum(["error", "warning"]),
  path: z.string(),
});
export type SpecIssue = z.infer<typeof specIssue>;
