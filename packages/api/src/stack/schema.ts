/**
 * Declarative stack-file schema.
 *
 * One YAML document per project. The shape is compose-compatible so the
 * eventual apply path can hand the rendered string straight to
 * `docker stack deploy -c <file>`. Otterstack-specific knobs ride the
 * `x-otterstack` extension key — compose ignores top-level + service-level
 * `x-*` fields, so a third party can still parse / lint the file.
 *
 * `version` here is OUR schema version, not compose's. Compose's `version`
 * field is intentionally absent (recent compose specs ignore it, and we
 * don't want operators editing it).
 */

import * as z from "zod";

const positiveInt = z.number().int().nonnegative();
const composeDuration = z
  .string()
  .regex(/^\d+(ns|us|µs|ms|s|m|h)?$/, "compose duration (e.g. '30s', '5ms')");

// ── Volumes / networks / secrets / configs (compose top-level entries) ──

export const stackVolumeSchema = z.object({
  driver: z.string().optional(),
  driver_opts: z.record(z.string(), z.string()).optional(),
  external: z.boolean().optional(),
  name: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type StackVolume = z.infer<typeof stackVolumeSchema>;

export const stackNetworkSchema = z.object({
  driver: z.string().optional(),
  attachable: z.boolean().optional(),
  external: z.boolean().optional(),
  name: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type StackNetwork = z.infer<typeof stackNetworkSchema>;

export const stackSecretSchema = z.object({
  external: z.boolean().optional(),
  file: z.string().optional(),
  name: z.string().optional(),
});
export type StackSecret = z.infer<typeof stackSecretSchema>;

export const stackConfigSchema = z.object({
  external: z.boolean().optional(),
  file: z.string().optional(),
  name: z.string().optional(),
});
export type StackConfig = z.infer<typeof stackConfigSchema>;

// ── Service sub-shapes (compose) ───────────────────────────────────────

export const stackPortSchema = z.object({
  target: positiveInt,
  published: positiveInt.optional(),
  protocol: z.enum(["tcp", "udp"]).optional(),
  mode: z.enum(["host", "ingress"]).optional(),
  app_protocol: z.enum(["http", "tcp"]).optional(),
});
export type StackPort = z.infer<typeof stackPortSchema>;

export const stackVolumeMountSchema = z.object({
  type: z.enum(["volume", "bind", "tmpfs"]),
  source: z.string().optional(),
  target: z.string(),
  read_only: z.boolean().optional(),
  /** otterstack-only: inline file content materialized at deploy time. */
  x_otterstack_content: z.string().optional(),
});
export type StackVolumeMount = z.infer<typeof stackVolumeMountSchema>;

export const stackHealthcheckSchema = z.object({
  test: z.union([z.string(), z.array(z.string())]),
  interval: composeDuration.optional(),
  timeout: composeDuration.optional(),
  retries: positiveInt.optional(),
  start_period: composeDuration.optional(),
  disable: z.boolean().optional(),
});
export type StackHealthcheck = z.infer<typeof stackHealthcheckSchema>;

export const stackResourceLimitsSchema = z.object({
  cpus: z.string().optional(),
  memory: z.string().optional(),
  // Compose deploy.resources.limits.pids — max PIDs per replica.
  pids: positiveInt.optional(),
});

export const stackResourcesSchema = z.object({
  limits: stackResourceLimitsSchema.optional(),
  reservations: stackResourceLimitsSchema.optional(),
});
export type StackResources = z.infer<typeof stackResourcesSchema>;

export const stackRestartPolicySchema = z.object({
  condition: z.enum(["none", "on-failure", "any"]).optional(),
  delay: composeDuration.optional(),
  max_attempts: positiveInt.optional(),
  window: composeDuration.optional(),
});

export const stackUpdateConfigSchema = z.object({
  parallelism: positiveInt.optional(),
  delay: composeDuration.optional(),
  failure_action: z.enum(["continue", "rollback", "pause"]).optional(),
  monitor: composeDuration.optional(),
  max_failure_ratio: z.number().min(0).max(1).optional(),
  order: z.enum(["stop-first", "start-first"]).optional(),
});

export const stackDeploySchema = z.object({
  replicas: positiveInt.optional(),
  mode: z.enum(["replicated", "global"]).optional(),
  endpoint_mode: z.enum(["vip", "dnsrr"]).optional(),
  resources: stackResourcesSchema.optional(),
  restart_policy: stackRestartPolicySchema.optional(),
  update_config: stackUpdateConfigSchema.optional(),
  rollback_config: stackUpdateConfigSchema.optional(),
  labels: z.record(z.string(), z.string()).optional(),
  placement: z
    .object({
      constraints: z.array(z.string()).optional(),
      preferences: z.array(z.record(z.string(), z.string())).optional(),
    })
    .optional(),
});
export type StackDeploy = z.infer<typeof stackDeploySchema>;

// ── otterstack extension block ─────────────────────────────────────────

export const stackOtterstackExtensionSchema = z.object({
  kind: z.enum(["database", "service"]),
  engine: z.enum(["postgres", "redis", "mariadb", "mongodb"]).optional(),
  resourceId: z.string(),
  projectId: z.string(),
  publicEnabled: z.boolean().optional(),
  publicHostname: z.string().optional(),
  /** Bumped by the apply path to force a no-op spec change through swarm
   *  (analogous to ForceUpdate today). */
  redeployToken: z.string().optional(),
  /** UI-only graph coordinates so the canvas position survives
   *  round-trips through the file. */
  graph: z
    .object({ x: z.number(), y: z.number() })
    .optional(),

  // Lifecycle hook — runs once before the new replicas take traffic.
  // No compose-deploy equivalent; rides under x-otterstack so the
  // value survives YAML round-trip.
  preDeploy: z.array(z.string()).optional(),

  // Build configuration for git-sourced services. Same discriminated
  // shape as the manifest; carried in the extension so the compose
  // file is a lossless render of the project state.
  buildConfig: z.unknown().optional(),

  // Extended resource limits with no docker-swarm deploy.resources
  // slot. Surfaced for tools that want the value (and our own UI).
  diskLimitMb: z.number().int().positive().optional(),
  swapLimitMb: z.number().int().positive().optional(),
});
export type StackOtterstackExtension = z.infer<
  typeof stackOtterstackExtensionSchema
>;

// ── Service ────────────────────────────────────────────────────────────

export const stackServiceSchema = z.object({
  image: z.string().optional(),
  command: z.union([z.string(), z.array(z.string())]).optional(),
  entrypoint: z.union([z.string(), z.array(z.string())]).optional(),
  hostname: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  ports: z.array(stackPortSchema).optional(),
  volumes: z.array(stackVolumeMountSchema).optional(),
  networks: z.array(z.string()).optional(),
  healthcheck: stackHealthcheckSchema.optional(),
  depends_on: z.array(z.string()).optional(),
  deploy: stackDeploySchema.optional(),
  labels: z.record(z.string(), z.string()).optional(),
  "x-otterstack": stackOtterstackExtensionSchema,
});
export type StackService = z.infer<typeof stackServiceSchema>;

// ── Top-level file ─────────────────────────────────────────────────────

export const stackFileSchema = z.object({
  version: z.string(),
  services: z.record(z.string(), stackServiceSchema),
  networks: z.record(z.string(), stackNetworkSchema).optional(),
  volumes: z.record(z.string(), stackVolumeSchema).optional(),
  secrets: z.record(z.string(), stackSecretSchema).optional(),
  configs: z.record(z.string(), stackConfigSchema).optional(),
});
export type StackFile = z.infer<typeof stackFileSchema>;

/** Current StackFile schema version. Bump on breaking shape changes. */
export const STACK_FILE_SCHEMA_VERSION = "1";

/** Healthy default healthcheck cadence used when an engine doesn't override. */
export const STACK_DEFAULT_HEALTHCHECK = {
  interval: "5s",
  timeout: "3s",
  retries: 20,
} as const;
