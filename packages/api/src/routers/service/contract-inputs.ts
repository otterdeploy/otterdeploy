/**
 * Input shapes for `service.*` — what a caller may send.
 *
 * Separate from ./contract-schemas.ts (what a service looks like coming back)
 * because the two drift for good reasons: an input accepts partials and
 * optionals a response never would, and reading them interleaved made it easy
 * to mistake one for the other.
 */

import * as z from "zod";

import { projectIdField, resourceIdField } from "../project/contract/shared";
import { servicePortInputSchema } from "./contract-schemas";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const envKeyRegex = /^[A-Z_][A-Z0-9_]*$/;

export const createServiceInput = z.object({
  projectId: projectIdField,
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, {
      message: "name must be lowercase letters, digits, and dashes",
    }),
  // "image" = pre-built docker image, image string is final. "git" =
  // built by apps/builder from the project's git binding; image is
  // accepted as a placeholder ("pending:initial") and overwritten on
  // first build. Defaults to "image" so existing callers don't break.
  source: z.enum(["image", "git", "upload"]).optional(),
  sourceSubdir: z.string().nullable().optional(),
  image: z.string().min(1),
  command: z.array(z.string()).nullable().optional(),
  entrypoint: z.array(z.string()).nullable().optional(),
  replicas: z.number().int().nonnegative().optional(),

  // Image-sourced services must publish at least one port (otherwise
  // there's nothing to route to). Git-sourced services may publish zero
  // ports at create time — the user might be building a worker. Enforced
  // in the handler since zod can't see `source` from inside the array.
  ports: z.array(servicePortInputSchema),
  env: z.array(z.object({ key: z.string().regex(envKeyRegex), value: z.string() })).optional(),

  restart: z
    .object({
      condition: z.enum(["none", "on-failure", "any"]).optional(),
      maxAttempts: z.number().int().nonnegative().nullable().optional(),
      delayMs: z.number().int().nonnegative().optional(),
    })
    .optional(),

  healthcheck: z
    .object({
      cmd: z.array(z.string()).nullable().optional(),
      intervalMs: z.number().int().positive().nullable().optional(),
      timeoutMs: z.number().int().positive().nullable().optional(),
      retries: z.number().int().nonnegative().nullable().optional(),
      startMs: z.number().int().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),

  resources: z
    .object({
      cpuLimit: z.number().nonnegative().nullable().optional(),
      memoryLimitMb: z.number().int().positive().nullable().optional(),
      cpuReservation: z.number().nonnegative().nullable().optional(),
      memoryReservationMb: z.number().int().positive().nullable().optional(),
    })
    .optional(),

  // Lifecycle hooks — exec-form shell commands, run in order off the new
  // image. preDeploy runs before the rollout (db migrations); postDeploy
  // after the new replicas are live (cache warmup, smoke checks).
  preDeploy: z.array(z.string()).nullable().optional(),
  postDeploy: z.array(z.string()).nullable().optional(),
});

export const updateServiceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,

  image: z.string().min(1).optional(),
  command: z.array(z.string()).nullable().optional(),
  entrypoint: z.array(z.string()).nullable().optional(),
  replicas: z.number().int().nonnegative().optional(),

  ports: z.array(servicePortInputSchema).optional(),

  restart: z
    .object({
      condition: z.enum(["none", "on-failure", "any"]).optional(),
      maxAttempts: z.number().int().nonnegative().nullable().optional(),
      delayMs: z.number().int().nonnegative().optional(),
    })
    .optional(),

  healthcheck: z
    .object({
      cmd: z.array(z.string()).nullable().optional(),
      intervalMs: z.number().int().positive().nullable().optional(),
      timeoutMs: z.number().int().positive().nullable().optional(),
      retries: z.number().int().nonnegative().nullable().optional(),
      startMs: z.number().int().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),

  resources: z
    .object({
      cpuLimit: z.number().nonnegative().nullable().optional(),
      memoryLimitMb: z.number().int().positive().nullable().optional(),
      cpuReservation: z.number().nonnegative().nullable().optional(),
      memoryReservationMb: z.number().int().positive().nullable().optional(),
    })
    .optional(),

  // Lifecycle hooks — see createServiceInput. Null clears; omitted leaves
  // the stored value untouched (patch semantics).
  preDeploy: z.array(z.string()).nullable().optional(),
  postDeploy: z.array(z.string()).nullable().optional(),
});

export const getServiceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

export const rollbackServiceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** The prior deployment whose image to roll back to. */
  deploymentId: z.string(),
});

// `service.build` returns just the id of the pending deployment row it
// enqueued — the UI watches it via the Deployments tab / SSE log stream.
export const buildServiceOutput = z.object({
  deploymentId: z.string(),
});

export const listServicesInput = z.object({
  projectId: projectIdField,
});

export const setEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  key: z.string().regex(envKeyRegex),
  value: z.string(),
});

export const unsetEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  key: z.string().regex(envKeyRegex),
});

export const bulkEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  vars: z.array(z.object({ key: z.string().regex(envKeyRegex), value: z.string() })),
});

// --- Custom domains ---

const domainField = z
  .string()
  .min(1)
  .max(253)
  .transform((s) => s.trim().toLowerCase());

export const listDomainsInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

// Persistent volume mounts. A container path (absolute) backed by a docker
// named volume that survives redeploys — first-class storage for a plain
// service, the thing the compose detour used to be required for.
const mountPathField = z.string().min(1).regex(/^\//, "mount path must be absolute (start with /)");

export const serviceMountSchema = z.object({
  mountPath: z.string(),
  volumeName: z.string(),
  readOnly: z.boolean(),
});

export const addMountInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  mountPath: mountPathField,
  readOnly: z.boolean().optional(),
});

export const removeMountInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  mountPath: mountPathField,
});

export const addDomainInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  domain: domainField,
});

export const updateDomainInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  routeId: z.string(),
  domain: domainField,
});

export const domainRouteInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  routeId: z.string(),
});
