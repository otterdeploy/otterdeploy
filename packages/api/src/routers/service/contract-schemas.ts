/**
 * Response/entity shapes for `service.*`.
 *
 * Split out of contract.ts, which had grown past the 250-line cap with three
 * distinct concerns in one file: what a service LOOKS like (here), what
 * callers may SEND (./contract-inputs.ts), and the procedure list itself.
 * Splitting on those seams keeps each readable on its own and makes the
 * dependency one-way — schemas know nothing about inputs or procedures.
 */

import * as z from "zod";

import { projectIdField, resourceIdField } from "../project/contract/shared";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const servicePortSchema = z.object({
  id: z.string(),
  containerPort: z.number().int().positive(),
  protocol: z.enum(["tcp", "udp"]),
  appProtocol: z.enum(["http", "tcp"]),
  isPrimary: z.boolean(),
});

export const servicePortInputSchema = z.object({
  containerPort: z.number().int().positive(),
  protocol: z.enum(["tcp", "udp"]).optional(),
  appProtocol: z.enum(["http", "tcp"]).optional(),
  isPrimary: z.boolean().optional(),
});

const serviceRestartSchema = z.object({
  condition: z.enum(["none", "on-failure", "any"]),
  maxAttempts: z.number().int().nonnegative().nullable(),
  delayMs: z.number().int().nonnegative(),
});

const serviceHealthcheckSchema = z
  .object({
    cmd: z.array(z.string()).nullable(),
    intervalMs: z.number().int().positive().nullable(),
    timeoutMs: z.number().int().positive().nullable(),
    retries: z.number().int().nonnegative().nullable(),
    startMs: z.number().int().nonnegative().nullable(),
  })
  .nullable();

const serviceResourcesSchema = z.object({
  cpuLimit: z.number().nonnegative().nullable(),
  memoryLimitMb: z.number().int().positive().nullable(),
  cpuReservation: z.number().nonnegative().nullable(),
  memoryReservationMb: z.number().int().positive().nullable(),
});

const serviceRuntimeSchema = z.object({
  serviceId: z.string().nullable(),
  serviceName: z.string(),
  networkName: z.string(),
  status: z.enum(["running", "starting", "stopped", "missing", "error"]),
  health: z.enum(["healthy", "unhealthy", "starting"]).nullable(),
});

export const serviceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  status: z.enum(["draft", "valid", "invalid"]),

  image: z.string(),
  imageDigest: z.string().nullable(),
  command: z.array(z.string()).nullable(),
  entrypoint: z.array(z.string()).nullable(),
  replicas: z.number().int().nonnegative(),
  // Non-null = paused (scaled to zero via service.pause); holds the replica
  // count service.resume restores. Null = not paused.
  pausedReplicas: z.number().int().positive().nullable(),
  placementServerId: z.string().nullable(),

  restart: serviceRestartSchema,
  healthcheck: serviceHealthcheckSchema,
  resources: serviceResourcesSchema,
  ports: z.array(servicePortSchema),

  publicEnabled: z.boolean(),
  publicDomain: z.string().nullable(),
  internalHostname: z.string(),

  runtime: serviceRuntimeSchema,

  createdAt: z.string(),
  updatedAt: z.string(),
});

export const envVarSchema = z.object({
  id: z.string(),
  serviceResourceId: z.string(),
  key: z.string(),
  value: z.string(),
});

// One published host for a service. `id` is the underlying proxy_route id —
// the same id the deployment-protection / guest surfaces address.
export const serviceDomainSchema = z.object({
  id: z.string(),
  // Scoping ids, carried on every row so the web client's on-demand
  // `serviceDomainsCollection` can filter subsets by (project, resource) via
  // `where` (loadSubset) — same reason `deploymentTaskSchema` extends its base.
  projectId: projectIdField,
  resourceId: resourceIdField,
  domain: z.string(),
  /** Container port this host proxies to. Each host picks its own, so one
   *  service can publish an API on :8000 and a dashboard on :3000. */
  port: z.number().int(),
  source: z.enum(["generated", "custom"]),
  isPrimary: z.boolean(),
  // "disabled" is the system gate (unexposed / verification pending);
  // "paused" is the operator's explicit off switch — config intact, out of Caddy.
  status: z.enum(["live", "disabled", "paused"]),
  // Reachability of the host (add-and-go): does DNS point here yet, and how.
  dnsState: z.enum(["pointed", "proxied", "unpointed", "unknown"]),
  dnsCheckedAt: z.string().nullable(),
  // TLS cert lifecycle, promoted from Caddy's ACME log events.
  certState: z.enum(["unknown", "obtaining", "valid", "failed"]),
  certError: z.string().nullable(),
  certCheckedAt: z.string().nullable(),
  usesAcme: z.boolean(),
  protected: z.boolean(),
  ownershipVerified: z.boolean(),
  verifyRecord: z.string().nullable(),
  verifyToken: z.string().nullable(),
  // The IP to point an A record at (our server). Null when unknown (dev).
  dnsTarget: z.string().nullable(),
});
