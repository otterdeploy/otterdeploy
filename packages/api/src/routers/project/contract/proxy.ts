/**
 * Caddy proxy-route schemas + slice. One row per layer-4 / HTTP route
 * the caddy reconciler maintains. `resourceId` is nullable so cluster-
 * wide routes (admin endpoints, etc.) can exist without a resource owner.
 */

import { oc } from "@orpc/contract";
import { proxyRoute } from "@otterdeploy/db/schema";
import { customDirectivesSchema } from "@otterdeploy/shared/custom-directives";
import { routePolicySchema } from "@otterdeploy/shared/route-policy";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { proxyAccessContractSlice } from "./proxy-access";
import { basePath, projectNotFoundErrors, resourceNotFoundErrors, tag } from "./shared";
import { projectIdField, proxyRouteIdField, resourceIdField } from "./shared";

// The access-PIN hash never leaves the server. Omitted here so no endpoint
// that outputs a route can leak it (PIN state is read via `accessPin` below).
export const proxyRouteSchema = createSelectSchema(proxyRoute)
  .omit({ accessPinHash: true, domainVerifyToken: true })
  .extend({
    id: proxyRouteIdField,
    projectId: projectIdField,
    resourceId: resourceIdField.nullable(),
    routePolicy: routePolicySchema,
  });

const listProxyRoutesInput = z.object({
  projectId: projectIdField,
});

/** Read-only render of a project's contribution to the edge Caddyfile.
 *  The reconciler's per-project fragment plus the short revision SHA. */
const projectCaddyfileSchema = z.object({
  caddyfile: z.string(),
  revision: z.string(),
});

// ─── TLS certificates (live edge probe) ─────────────────────────────
/** One probed certificate: what Caddy actually serves for a domain right
 *  now (issuer/expiry/SANs), or an error when the probe couldn't connect. */
const certificateSchema = z.object({
  domain: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
  sans: z.array(z.string()),
  notBefore: z.string().nullable(),
  notAfter: z.string().nullable(),
  daysRemaining: z.number().nullable(),
  serial: z.string().nullable(),
  fingerprint: z.string().nullable(),
  selfSigned: z.boolean(),
  status: z.enum(["valid", "expiring", "expired", "internal", "error"]),
});

const projectCertificatesSchema = z.object({
  edgeHost: z.string(),
  probedAt: z.string(),
  certificates: z.array(certificateSchema),
});

const setRoutePolicyInput = z.object({
  routeId: proxyRouteIdField,
  policy: routePolicySchema,
});

// Raw Caddyfile directives for the route's site block (od-f4rb). The schema
// enforces structural integrity only (length cap, brace balance so the text
// cannot escape its site block); Caddy's /adapt validation with rollback is
// the syntax gate. Null clears the block.
const setCustomDirectivesInput = z.object({
  routeId: proxyRouteIdField,
  directives: customDirectivesSchema.nullable(),
});

// ─── Global edge-proxy options (instance-wide platform_settings) ─────
const globalCaddyOptionsSchema = z.object({
  /** ACME registration email (Let's Encrypt). Null when unset. */
  acmeEmail: z.string().nullable(),
  /** Caddy auto HTTP→HTTPS redirect; false ⇒ `auto_https disable_redirects`. */
  httpsAutoRedirect: z.boolean(),
});

const setGlobalOptionsInput = z.object({
  /** Project context for auth/scoping; the options themselves are instance-wide. */
  projectId: projectIdField,
  acmeEmail: z.string().max(254).nullable(),
  httpsAutoRedirect: z.boolean(),
});

const saveRoutePolicyResultSchema = z.object({
  route: proxyRouteSchema,
  applied: z.boolean(),
  error: z.string().nullable(),
});

// ─── Deployment protection (auth wall) ──────────────────────────────
// The access surface (PIN, share links, bypass tokens, guests) lives in
// ./proxy-access and is spread into this slice below.
const setProtectionInput = z.object({
  routeId: proxyRouteIdField,
  protected: z.boolean(),
});

// The operator's route on/off switch. `enabled: false` means user-disable -
// the wire keeps the intuitive name, the server maps it onto the
// `disabledByUser` column so the system-owned `enabled` gate is untouched.
const setEnabledInput = z.object({
  routeId: proxyRouteIdField,
  enabled: z.boolean(),
});

export const proxyContractSlice = {
  ...proxyAccessContractSlice,

  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/proxy-routes`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(z.array(proxyRouteSchema)),

  caddyfile: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/caddyfile`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(projectCaddyfileSchema),

  certificates: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/certificates`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(projectCertificatesSchema),

  globalOptions: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/global-options`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(globalCaddyOptionsSchema),

  setGlobalOptions: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/global-options`,
      tag,
      method: "POST",
    })
    .input(setGlobalOptionsInput)
    .output(globalCaddyOptionsSchema),

  setRoutePolicy: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/policy`,
      tag,
      method: "POST",
    })
    .input(setRoutePolicyInput)
    .output(saveRoutePolicyResultSchema),

  setCustomDirectives: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/directives`,
      tag,
      method: "POST",
    })
    .input(setCustomDirectivesInput)
    .output(saveRoutePolicyResultSchema),

  setProtection: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/protection`,
      tag,
      method: "POST",
    })
    .input(setProtectionInput)
    .output(proxyRouteSchema),

  setEnabled: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/enabled`,
      tag,
      method: "POST",
    })
    .input(setEnabledInput)
    .output(proxyRouteSchema),
};
