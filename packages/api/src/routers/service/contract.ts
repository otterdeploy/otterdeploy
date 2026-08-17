import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "service";
const basePath = "/projects/{projectId}/services";

import {
  addDomainInput,
  addMountInput,
  buildServiceOutput,
  bulkEnvInput,
  checkDomainInput,
  createServiceInput,
  domainRouteInput,
  getServiceInput,
  listDomainsInput,
  listServicesInput,
  removeMountInput,
  rollbackServiceInput,
  serviceMountSchema,
  setDomainEnabledInput,
  setEnvInput,
  unsetEnvInput,
  updateDomainInput,
  updateServiceInput,
} from "./contract-inputs";
import { envVarSchema, serviceDomainSchema, serviceSchema } from "./contract-schemas";

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
  UNKNOWN_PORT: {
    status: 400,
    message: "That port isn't one this service publishes" as const,
  },
  DOMAIN_CONFLICT: { status: 409, message: "Domain is already in use or invalid" as const },
  DOMAIN_NOT_FOUND: { status: 404, message: "Domain not found" as const },
  MISSING_BUILD_BINDING: {
    status: 412,
    message:
      "Project has no git/registry/image binding. Configure it in Settings before creating a source-built service" as const,
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

  // Roll a service back to a prior deployment's image (image-only, current
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
      // The service is git-sourced but the build can't be enqueued yet, no
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

  // Pause: scale the service to zero replicas while remembering the desired
  // count, so Resume restores exactly what the operator had. Config, env,
  // routes, and volumes are all preserved; only the running containers stop.
  // Idempotent: pausing a paused service (or resuming a non-paused one) is a
  // no-op that returns the current view.
  pause: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
    })
    .meta({ path: `${basePath}/{resourceId}/pause`, tag, method: "POST" })
    .input(getServiceInput)
    .output(serviceSchema),

  resume: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
    })
    .meta({ path: `${basePath}/{resourceId}/resume`, tag, method: "POST" })
    .input(getServiceInput)
    .output(serviceSchema),

  expose: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      NO_HTTP_PORT: sharedErrors.NO_HTTP_PORT,
      // The host we'd publish on is already routed elsewhere in this install.
      // Surfaced instead of the 500 an unguarded unique-violation used to give.
      DOMAIN_CONFLICT: sharedErrors.DOMAIN_CONFLICT,
      // The service has no real domain, so the only host we can publish it on
      // is a throwaway `<slug>.<ip>.sslip.io`. Expose refuses rather than doing
      // that silently; `data.generatedDomain` is the host the caller can opt
      // into by retrying with `allowGeneratedDomain: true`.
      NO_PUBLIC_DOMAIN: {
        status: 409 as const,
        message:
          "This service has no domain, so it can only go public on a temporary sslip.io URL." as const,
        data: z.object({ generatedDomain: z.string() }),
      },
    })
    .meta({ path: `${basePath}/{resourceId}/expose`, tag, method: "POST" })
    .input(
      // `allowGeneratedDomain` is the operator's explicit opt-in to being
      // published on the sslip.io fallback when no real domain is configured.
      // Absent/false ⇒ expose refuses with NO_PUBLIC_DOMAIN instead.
      getServiceInput.extend({ allowGeneratedDomain: z.boolean().optional() }),
    )
    .output(serviceSchema),

  // Pin the service to one server (or clear the pin) and move it there. Always
  // rolls the service: a placement constraint that hasn't been applied is not
  // a placement, it's an intention.
  setPlacement: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      // The service has node-local volumes that will NOT follow it. Retry with
      // `acknowledgeVolumeLoss: true` to move anyway and start with empty ones.
      PLACEMENT_VOLUME_LOSS: {
        status: 409 as const,
        message: "Moving this service leaves its volumes behind." as const,
        data: z.object({ mounts: z.array(z.string()) }),
      },
    })
    .meta({ path: `${basePath}/{resourceId}/placement`, tag, method: "POST" })
    .input(
      getServiceInput.extend({
        // Null releases the service back to the scheduler.
        serverId: z.string().nullable(),
        acknowledgeVolumeLoss: z.boolean().optional(),
      }),
    )
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

    /**
     * Pre-flight availability for the add-domain field. Read-only: it never
     * reserves the name, so a `true` here can still lose a race with another
     * operator: `add` remains the authority and still answers 409.
     */
    check: oc
      .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
      .meta({ path: `${basePath}/{resourceId}/domains/check`, tag, method: "GET" })
      .input(checkDomainInput)
      .output(
        z.object({
          domain: z.string(),
          available: z.boolean(),
          reason: z.enum(["ok", "invalid", "reserved", "taken"]),
        }),
      ),

    /**
     * Mint the platform-generated host for this service (org base domain, or
     * the sslip.io fallback) and publish on it. Unlike `expose`, this always
     * produces a generated host: it is the "Generate Domain" button, not a
     * toggle, and needs no sslip opt-in prompt because asking for it IS the
     * opt-in.
     */
    generate: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        NO_HTTP_PORT: sharedErrors.NO_HTTP_PORT,
        DOMAIN_CONFLICT: sharedErrors.DOMAIN_CONFLICT,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/generate`, tag, method: "POST" })
      .input(listDomainsInput)
      .output(serviceDomainSchema),

    add: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        NO_HTTP_PORT: sharedErrors.NO_HTTP_PORT,
        UNKNOWN_PORT: sharedErrors.UNKNOWN_PORT,
        DOMAIN_CONFLICT: sharedErrors.DOMAIN_CONFLICT,
      })
      .meta({ path: `${basePath}/{resourceId}/domains`, tag, method: "POST" })
      .input(addDomainInput)
      .output(serviceDomainSchema),

    update: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
        UNKNOWN_PORT: sharedErrors.UNKNOWN_PORT,
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

    /**
     * Write this domain's required DNS through the workspace's Cloudflare
     * token. The record set is derived server-side from the route. There is no
     * caller-supplied record input, so a connected token cannot be used to
     * write arbitrary records into the operator's zone.
     */
    autoConfigureDns: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
        DNS_NOT_CONFIGURABLE: {
          status: 400 as const,
          message: "This domain's DNS can't be configured automatically" as const,
        },
      })
      .meta({
        path: `${basePath}/{resourceId}/domains/{routeId}/auto-configure-dns`,
        tag,
        method: "POST",
      })
      .input(domainRouteInput)
      .output(z.object({ ok: z.boolean(), recordIds: z.array(z.string()) })),

    setPrimary: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/{routeId}/primary`, tag, method: "POST" })
      .input(domainRouteInput)
      .output(serviceDomainSchema),

    /**
     * Pause / resume one host without deleting it. `enabled: false` takes the
     * route out of Caddy but keeps every setting (cert decision, verification
     * state) intact, so `enabled: true` restores it with nothing to re-prove.
     */
    setEnabled: oc
      .errors({
        NOT_FOUND: sharedErrors.NOT_FOUND,
        DOMAIN_NOT_FOUND: sharedErrors.DOMAIN_NOT_FOUND,
      })
      .meta({ path: `${basePath}/{resourceId}/domains/{routeId}/enabled`, tag, method: "POST" })
      .input(setDomainEnabledInput)
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

  // Persistent volumes attached to a plain service. `add` provisions (docker
  // auto-creates the named volume on next schedule) and redeploys so the mount
  // takes effect; `remove` detaches it (the volume's data is left intact).
  mounts: {
    list: oc
      .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
      .meta({ path: `${basePath}/{resourceId}/mounts`, tag, method: "GET" })
      .input(getServiceInput)
      .output(z.array(serviceMountSchema)),

    add: oc
      .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
      .meta({ path: `${basePath}/{resourceId}/mounts`, tag, method: "POST" })
      .input(addMountInput)
      .output(serviceMountSchema),

    remove: oc
      .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
      .meta({ path: `${basePath}/{resourceId}/mounts`, tag, method: "DELETE" })
      .input(removeMountInput)
      .output(z.object({ ok: z.boolean() })),
  },
};
