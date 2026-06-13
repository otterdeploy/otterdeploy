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
