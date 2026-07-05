import { oc } from "@orpc/contract";
import * as z from "zod";

import { projectIdField, resourceIdField } from "../project/contract/shared";

const tag = "service";
const basePath = "/projects/{projectId}/services";

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

const servicePortInputSchema = z.object({
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

const serviceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  status: z.enum(["draft", "valid", "invalid"]),

  image: z.string(),
  imageDigest: z.string().nullable(),
  command: z.array(z.string()).nullable(),
  entrypoint: z.array(z.string()).nullable(),
  replicas: z.number().int().nonnegative(),

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

const envVarSchema = z.object({
  id: z.string(),
  serviceResourceId: z.string(),
  key: z.string(),
  value: z.string(),
});

// One published host for a service. `id` is the underlying proxy_route id —
// the same id the deployment-protection / guest surfaces address.
const serviceDomainSchema = z.object({
  id: z.string(),
  // Scoping ids, carried on every row so the web client's on-demand
  // `serviceDomainsCollection` can filter subsets by (project, resource) via
  // `where` (loadSubset) — same reason `deploymentTaskSchema` extends its base.
  projectId: projectIdField,
  resourceId: resourceIdField,
  domain: z.string(),
  source: z.enum(["generated", "custom"]),
  isPrimary: z.boolean(),
  status: z.enum(["live", "disabled"]),
  // Reachability of the host (add-and-go): does DNS point here yet, and how.
  dnsState: z.enum(["pointed", "proxied", "unpointed", "unknown"]),
  dnsCheckedAt: z.string().nullable(),
  // TLS cert lifecycle, promoted from Caddy's ACME log events.
  certState: z.enum(["unknown", "obtaining", "valid", "failed"]),
  certError: z.string().nullable(),
  certCheckedAt: z.string().nullable(),
  usesAcme: z.boolean(),
  protected: z.boolean(),
  // The IP to point an A record at (our server). Null when unknown (dev).
  dnsTarget: z.string().nullable(),
});

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
  source: z.enum(["image", "git"]).optional(),
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

const getServiceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

const rollbackServiceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** The prior deployment whose image to roll back to. */
  deploymentId: z.string(),
});

// `service.build` returns just the id of the pending deployment row it
// enqueued — the UI watches it via the Deployments tab / SSE log stream.
const buildServiceOutput = z.object({
  deploymentId: z.string(),
});

const listServicesInput = z.object({
  projectId: projectIdField,
});

const setEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  key: z.string().regex(envKeyRegex),
  value: z.string(),
});

const unsetEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  key: z.string().regex(envKeyRegex),
});

const bulkEnvInput = z.object({
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

const listDomainsInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

const addDomainInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  domain: domainField,
});

const updateDomainInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  routeId: z.string(),
  domain: domainField,
});

const domainRouteInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  routeId: z.string(),
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const sharedErrors = {
  NOT_FOUND: { status: 404, message: "Service or project not found" as const },
  CONFLICT: { status: 409, message: "Conflict" as const },
  IN_USE: { status: 409, message: "Resource is referenced by another service" as const },
  INVALID_INPUT: { status: 400, message: "Invalid input" as const },
  REF_MISSING: { status: 400, message: "Referenced resource does not exist" as const },
  REF_CYCLE: { status: 400, message: "Variable reference cycle" as const },
  NO_HTTP_PORT: { status: 400, message: "Service has no HTTP port to expose" as const },
  DOMAIN_CONFLICT: { status: 409, message: "Domain is already in use or invalid" as const },
  DOMAIN_NOT_FOUND: { status: 404, message: "Domain not found" as const },
  MISSING_BUILD_BINDING: {
    status: 412,
    message:
      "Project has no git/registry/image binding — configure it in Settings before creating a source-built service" as const,
  },
};

export const serviceContract = {
  list: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
    })
    .meta({ path: basePath, tag, method: "GET" })
    .input(listServicesInput)
    .output(z.array(serviceSchema)),

  get: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
    })
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "GET" })
    .input(getServiceInput)
    .output(serviceSchema),

  create: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      CONFLICT: sharedErrors.CONFLICT,
      INVALID_INPUT: sharedErrors.INVALID_INPUT,
      MISSING_BUILD_BINDING: sharedErrors.MISSING_BUILD_BINDING,
      REF_MISSING: sharedErrors.REF_MISSING,
      REF_CYCLE: sharedErrors.REF_CYCLE,
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createServiceInput)
    .output(serviceSchema),

  update: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      INVALID_INPUT: sharedErrors.INVALID_INPUT,
      REF_MISSING: sharedErrors.REF_MISSING,
      REF_CYCLE: sharedErrors.REF_CYCLE,
    })
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "PATCH" })
    .input(updateServiceInput)
    .output(serviceSchema),

  delete: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      IN_USE: sharedErrors.IN_USE,
    })
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "DELETE" })
    .input(getServiceInput)
    .output(z.object({ ok: z.boolean() })),

  restart: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
    })
    .meta({ path: `${basePath}/{resourceId}/restart`, tag, method: "POST" })
    .input(getServiceInput)
    .output(serviceSchema),

  // Roll a service back to a prior deployment's image (image-only — current
  // env/config is kept). Records a new reason="rollback" deployment.
  rollback: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      NOT_ROLLBACKABLE: {
        status: 400,
        message: "This deployment can't be rolled back to" as const,
      },
    })
    .meta({
      path: `${basePath}/{resourceId}/rollback/{deploymentId}`,
      tag,
      method: "POST",
    })
    .input(rollbackServiceInput)
    .output(serviceSchema),

  // Trigger a build for a git-sourced service from the current head of its
  // project's production branch. The first-build-on-create path and the git
  // push webhook are the only other build triggers; this is the manual
  // "Deploy" for an already-created service (e.g. one whose initial build
  // never ran). No-op for image-sourced services (NOT_GIT_SOURCED).
  build: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      NOT_GIT_SOURCED: {
        status: 400,
        message: "Only git-sourced services can be built.",
      },
      // The service is git-sourced but the build can't be enqueued yet — no
      // git repo bound, an inaccessible repo, a failed SHA lookup, … The
      // handler overrides `message` with the specific human-readable reason.
      BUILD_NOT_READY: {
        status: 422,
        message: "This service isn't ready to build yet.",
      },
    })
    .meta({ path: `${basePath}/{resourceId}/build`, tag, method: "POST" })
    .input(getServiceInput)
    .output(buildServiceOutput),

  expose: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      NO_HTTP_PORT: sharedErrors.NO_HTTP_PORT,
    })
    .meta({ path: `${basePath}/{resourceId}/expose`, tag, method: "POST" })
    .input(getServiceInput)
    .output(serviceSchema),

  unexpose: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
    })
    .meta({ path: `${basePath}/{resourceId}/unexpose`, tag, method: "POST" })
    .input(getServiceInput)
    .output(serviceSchema),

  env: {
    list: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/env`, tag, method: "GET" })
      .input(getServiceInput)
      .output(z.array(envVarSchema)),

    set: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        INVALID_INPUT: sharedErrors.INVALID_INPUT,
        REF_MISSING: sharedErrors.REF_MISSING,
        REF_CYCLE: sharedErrors.REF_CYCLE,
      })
      .meta({ path: `${basePath}/{resourceId}/env/{key}`, tag, method: "PUT" })
      .input(setEnvInput)
      .output(envVarSchema),

    unset: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/env/{key}`, tag, method: "DELETE" })
      .input(unsetEnvInput)
      .output(z.object({ ok: z.boolean() })),

    bulkSet: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        INVALID_INPUT: sharedErrors.INVALID_INPUT,
        REF_MISSING: sharedErrors.REF_MISSING,
        REF_CYCLE: sharedErrors.REF_CYCLE,
      })
      .meta({ path: `${basePath}/{resourceId}/env`, tag, method: "POST" })
      .input(bulkEnvInput)
      .output(z.array(envVarSchema)),
  },

  // Custom-domain management. A service publishes on one generated host
  // plus any number of operator-added custom hosts (DNS-verified before
  // they go live). Each host is one proxy_route, so deployment protection
  // and guests apply per domain.
  domains: {
    list: oc
      .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
      .meta({ path: `${basePath}/{resourceId}/domains`, tag, method: "GET" })
      .input(listDomainsInput)
      .output(z.array(serviceDomainSchema)),

    add: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        NO_HTTP_PORT: sharedErrors.NO_HTTP_PORT,
        DOMAIN_CONFLICT: sharedErrors.DOMAIN_CONFLICT,
      })
      .meta({ path: `${basePath}/{resourceId}/domains`, tag, method: "POST" })
      .input(addDomainInput)
      .output(serviceDomainSchema),

    update: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
        DOMAIN_CONFLICT: sharedErrors.DOMAIN_CONFLICT,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/{routeId}`, tag, method: "PATCH" })
      .input(updateDomainInput)
      .output(serviceDomainSchema),

    recheck: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/{routeId}/recheck`, tag, method: "POST" })
      .input(domainRouteInput)
      .output(serviceDomainSchema),

    setPrimary: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/{routeId}/primary`, tag, method: "POST" })
      .input(domainRouteInput)
      .output(serviceDomainSchema),

    remove: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/{routeId}`, tag, method: "DELETE" })
      .input(domainRouteInput)
      .output(z.object({ ok: z.boolean() })),
  },
};
