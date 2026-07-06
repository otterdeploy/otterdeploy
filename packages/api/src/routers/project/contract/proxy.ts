/**
 * Caddy proxy-route schemas + slice. One row per layer-4 / HTTP route
 * the caddy reconciler maintains. `resourceId` is nullable so cluster-
 * wide routes (admin endpoints, etc.) can exist without a resource owner.
 */

import { oc } from "@orpc/contract";
import { proxyRoute } from "@otterdeploy/db/schema";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { proxyAccessContractSlice } from "./proxy-access";
import { basePath, projectNotFoundErrors, resourceNotFoundErrors, tag } from "./shared";
import { projectIdField, proxyRouteIdField, resourceIdField } from "./shared";

// The access-PIN hash never leaves the server — omitted here so no endpoint
// that outputs a route can leak it (PIN state is read via `accessPin` below).
export const proxyRouteSchema = createSelectSchema(proxyRoute)
  .omit({ accessPinHash: true })
  .extend({
    id: proxyRouteIdField,
    projectId: projectIdField,
    resourceId: resourceIdField.nullable(),
  });

export const listProxyRoutesInput = z.object({
  projectId: projectIdField,
});

/** Read-only render of a project's contribution to the edge Caddyfile —
 *  the reconciler's per-project fragment plus the short revision SHA. */
const projectCaddyfileSchema = z.object({
  caddyfile: z.string(),
  revision: z.string(),
});

// ─── TLS certificates (live edge probe) ─────────────────────────────
/** One probed certificate — what Caddy actually serves for a domain right
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

// ─── Custom Caddy config (operator-authored) ────────────────────────
/** Max length for an operator-authored config blob (project-level or
 *  per-route). Generous — a Caddyfile snippet, not a whole site. */
const CUSTOM_CONFIG_MAX = 20_000;

/** A project's raw custom config for editing (null when unset). */
const projectCustomConfigSchema = z.object({
  config: z.string().nullable(),
});

const setProjectCustomConfigInput = z.object({
  projectId: projectIdField,
  /** Standalone Caddy blocks/snippets. Empty or null clears it. */
  config: z.string().max(CUSTOM_CONFIG_MAX).nullable(),
});

const setRouteDirectivesInput = z.object({
  routeId: proxyRouteIdField,
  /** Directives spliced inside the route's site block. Empty/null clears. */
  directives: z.string().max(CUSTOM_CONFIG_MAX).nullable(),
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

/** Result of saving custom config: the post-change render, plus whether it
 *  validated + went live (`applied`) or was rejected with Caddy's `error`. */
const saveCustomConfigResultSchema = z.object({
  caddyfile: z.string(),
  revision: z.string(),
  applied: z.boolean(),
  error: z.string().nullable(),
});

const saveRouteDirectivesResultSchema = z.object({
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

  customConfig: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/custom-config`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(projectCustomConfigSchema),

  setCustomConfig: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/custom-config`,
      tag,
      method: "POST",
    })
    .input(setProjectCustomConfigInput)
    .output(saveCustomConfigResultSchema),

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

  setRouteDirectives: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/directives`,
      tag,
      method: "POST",
    })
    .input(setRouteDirectivesInput)
    .output(saveRouteDirectivesResultSchema),

  setProtection: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/protection`,
      tag,
      method: "POST",
    })
    .input(setProtectionInput)
    .output(proxyRouteSchema),
};
