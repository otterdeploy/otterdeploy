/**
 * Caddy proxy-route schemas + slice. One row per layer-4 / HTTP route
 * the caddy reconciler maintains. `resourceId` is nullable so cluster-
 * wide routes (admin endpoints, etc.) can exist without a resource owner.
 */

import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { proxyRoute } from "@otterdeploy/db/schema";
import { basePath, projectNotFoundErrors, resourceNotFoundErrors, tag } from "./shared";
import { projectIdField, proxyRouteIdField, resourceIdField } from "./shared";

export const reconcileResultSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(
    z.object({
      projectId: z.string(),
      error: z.string(),
    }),
  ),
  revision: z.string(),
  loadError: z.string().optional(),
});

export const proxyRouteSchema = createSelectSchema(proxyRoute).extend({
  id: proxyRouteIdField,
  projectId: projectIdField,
  resourceId: resourceIdField.nullable(),
});

export const listProxyRoutesInput = z.object({
  projectId: projectIdField,
});

/** Read-only render of a project's contribution to the edge Caddyfile —
 *  the reconciler's per-project fragment plus the short revision SHA. */
export const projectCaddyfileSchema = z.object({
  caddyfile: z.string(),
  revision: z.string(),
});

// ─── Custom Caddy config (operator-authored) ────────────────────────
/** Max length for an operator-authored config blob (project-level or
 *  per-route). Generous — a Caddyfile snippet, not a whole site. */
const CUSTOM_CONFIG_MAX = 20_000;

/** A project's raw custom config for editing (null when unset). */
export const projectCustomConfigSchema = z.object({
  config: z.string().nullable(),
});

export const setProjectCustomConfigInput = z.object({
  projectId: projectIdField,
  /** Standalone Caddy blocks/snippets. Empty or null clears it. */
  config: z.string().max(CUSTOM_CONFIG_MAX).nullable(),
});

export const setRouteDirectivesInput = z.object({
  routeId: proxyRouteIdField,
  /** Directives spliced inside the route's site block. Empty/null clears. */
  directives: z.string().max(CUSTOM_CONFIG_MAX).nullable(),
});

/** Result of saving custom config: the post-change render, plus whether it
 *  validated + went live (`applied`) or was rejected with Caddy's `error`. */
export const saveCustomConfigResultSchema = z.object({
  caddyfile: z.string(),
  revision: z.string(),
  applied: z.boolean(),
  error: z.string().nullable(),
});

export const saveRouteDirectivesResultSchema = z.object({
  route: proxyRouteSchema,
  applied: z.boolean(),
  error: z.string().nullable(),
});

// ─── Deployment protection (auth wall) ──────────────────────────────
export const setProtectionInput = z.object({
  routeId: proxyRouteIdField,
  protected: z.boolean(),
});

export const createShareLinkInput = z.object({
  routeId: proxyRouteIdField,
  /** Link lifetime. Capped at 30 days. */
  expiresInHours: z.number().int().positive().max(24 * 30).default(72),
});

export const shareLinkSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});

export const createBypassTokenInput = z.object({
  routeId: proxyRouteIdField,
  /** Bypass-token lifetime for CI/automation. Capped at 1 year. */
  expiresInDays: z.number().int().positive().max(365).default(90),
});

export const bypassTokenSchema = z.object({
  /** The header automation must set, e.g. `x-otter-bypass`. */
  header: z.string(),
  token: z.string(),
  expiresAt: z.string(),
});

// ─── Guests (email one-time PIN, Cloudflare-style) ──────────────────
export const guestSchema = z.object({
  id: z.string(),
  email: z.string(),
  sessionHours: z.number(),
  createdAt: z.string(),
});

export const listGuestsInput = z.object({ routeId: proxyRouteIdField });

export const inviteGuestInput = z.object({
  routeId: proxyRouteIdField,
  email: z.email(),
  /** Session length after a successful code, in hours. Default 24. */
  sessionHours: z.number().int().positive().max(24 * 365).default(24),
});

export const removeGuestInput = z.object({
  routeId: proxyRouteIdField,
  guestId: z.string(),
});

export const proxyContractSlice = {
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

  createShareLink: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/share-link`,
      tag,
      method: "POST",
    })
    .input(createShareLinkInput)
    .output(shareLinkSchema),

  createBypassToken: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/bypass-token`,
      tag,
      method: "POST",
    })
    .input(createBypassTokenInput)
    .output(bypassTokenSchema),

  listGuests: oc
    .errors(resourceNotFoundErrors)
    .meta({ path: `${basePath}/proxy-routes/{routeId}/guests`, tag, method: "GET" })
    .input(listGuestsInput)
    .output(z.array(guestSchema)),

  inviteGuest: oc
    .errors(resourceNotFoundErrors)
    .meta({ path: `${basePath}/proxy-routes/{routeId}/guests`, tag, method: "POST" })
    .input(inviteGuestInput)
    .output(guestSchema),

  removeGuest: oc
    .errors(resourceNotFoundErrors)
    .meta({ path: `${basePath}/proxy-routes/{routeId}/guests/{guestId}`, tag, method: "POST" })
    .input(removeGuestInput)
    .output(z.object({ ok: z.boolean() })),
};
