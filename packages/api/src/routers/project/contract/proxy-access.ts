/**
 * Deployment-protection access slice of the proxy-route contract: the access
 * PIN, shareable links, CI bypass tokens, and guest invites (email one-time
 * PIN, Cloudflare-style). Split out of ./proxy (spread back into
 * proxyContractSlice) to keep that file under the max-lines cap.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, proxyRouteIdField, resourceNotFoundErrors, tag } from "./shared";

// ─── Access PIN (NetBird-style shared code) ─────────────────────────
/** Whether the route currently has an access PIN configured. Never the PIN
 *  or its hash — just the toggle state for the settings UI. */
const accessPinStatusSchema = z.object({ enabled: z.boolean() });

const getAccessPinInput = z.object({ routeId: proxyRouteIdField });

const setAccessPinInput = z.object({
  routeId: proxyRouteIdField,
  /** 4–8 digit numeric code. Null clears the PIN (and revokes all cookies
   *  minted from it). Setting a new value while one exists rotates it. */
  pin: z
    .string()
    .regex(/^\d{4,8}$/, "PIN must be 4–8 digits")
    .nullable(),
});

// ─── Share links + CI bypass tokens ─────────────────────────────────
const createShareLinkInput = z.object({
  routeId: proxyRouteIdField,
  /** Link lifetime. Capped at 30 days. */
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(72),
});

const shareLinkSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});

const createBypassTokenInput = z.object({
  routeId: proxyRouteIdField,
  /** Bypass-token lifetime for CI/automation. Capped at 1 year. */
  expiresInDays: z.number().int().positive().max(365).default(90),
});

const bypassTokenSchema = z.object({
  /** The header automation must set, e.g. `x-otter-bypass`. */
  header: z.string(),
  token: z.string(),
  expiresAt: z.string(),
});

// ─── Guests (email one-time PIN, Cloudflare-style) ──────────────────
const guestSchema = z.object({
  id: z.string(),
  email: z.string(),
  sessionHours: z.number(),
  createdAt: z.string(),
});

const listGuestsInput = z.object({ routeId: proxyRouteIdField });

const inviteGuestInput = z.object({
  routeId: proxyRouteIdField,
  email: z.email(),
  /** Session length after a successful code, in hours. Default 24. */
  sessionHours: z
    .number()
    .int()
    .positive()
    .max(24 * 365)
    .default(24),
});

const removeGuestInput = z.object({
  routeId: proxyRouteIdField,
  guestId: z.string(),
});

export const proxyAccessContractSlice = {
  accessPin: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/access-pin`,
      tag,
      method: "GET",
    })
    .input(getAccessPinInput)
    .output(accessPinStatusSchema),

  setAccessPin: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/proxy-routes/{routeId}/access-pin`,
      tag,
      method: "POST",
    })
    .input(setAccessPinInput)
    .output(accessPinStatusSchema),

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
