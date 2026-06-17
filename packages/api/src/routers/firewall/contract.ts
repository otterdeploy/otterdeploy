/**
 * Firewall contract — CrowdSec active decisions enriched with their alert
 * context (source geo / ASN / scenario / event count). CrowdSec is
 * identity-blind and cluster-wide, so this is org-admin context, not
 * per-project. See docs/designs/deployment-protection.md §10.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "firewall";

const firewallDecisionSchema = z.object({
  /** CrowdSec internal decision id. */
  id: z.number().nullable(),
  origin: z.string(),
  /** ban | captcha | throttle … */
  type: z.string(),
  /** Ip | Range | Country | AS … */
  scope: z.string(),
  /** The blocked IP / range / country. */
  value: z.string(),
  duration: z.string(),
  scenario: z.string(),
  // ── Enrichment from the matching alert. Null when there's no alert context
  //    (e.g. bulk community-blocklist IPs), so the row still renders. ──
  /** ISO-3166 alpha-2 country code, e.g. "FR". */
  country: z.string().nullable(),
  /** Autonomous system number of the source. */
  asNumber: z.string().nullable(),
  /** AS / network operator name, e.g. "OVH SAS". */
  asName: z.string().nullable(),
  /** How many parsed events triggered the originating alert. */
  eventsCount: z.number().nullable(),
  /** When the originating alert was first created (ISO-8601). */
  createdAt: z.string().nullable(),
});

const firewallStatusSchema = z.object({
  /** Both LAPI url + bouncer key are configured (enforcement wired into Caddy). */
  configured: z.boolean(),
  /** The control plane could reach the CrowdSec agent (via the Docker socket). */
  reachable: z.boolean(),
});

// ── Managed blocklists ──
const blocklistSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  catalogSlug: z.string().nullable(),
  enabled: z.boolean(),
  durationHours: z.number(),
  intervalMinutes: z.number(),
  lastSyncedAt: z.string().nullable(),
  lastStatus: z.enum(["ok", "error", "pending"]).nullable(),
  lastError: z.string().nullable(),
  lastCount: z.number().nullable(),
});

/** A curated catalog entry + whether it's already been added. */
const catalogListSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  durationHours: z.number(),
  intervalMinutes: z.number(),
  added: z.boolean(),
});

const blocklistListSchema = z.object({
  lists: z.array(blocklistSchema),
  catalog: z.array(catalogListSchema),
});

const syncResultSchema = z.object({
  ok: z.boolean(),
  count: z.number(),
  error: z.string().nullable(),
});

const consoleStatusSchema = z.object({
  /** Agent reachable so enrollment is possible. */
  available: z.boolean(),
});

const blocklistErrors = {
  NOT_FOUND: { status: 404, message: "Blocklist not found" as const },
  CONFLICT: { status: 409, message: "That list is already added" as const },
  INVALID_INPUT: { status: 422, message: "Invalid blocklist URL" as const },
};

export const firewallContract = {
  status: oc
    .meta({ path: "/firewall/status", tag, method: "GET" })
    .output(firewallStatusSchema),
  decisions: oc
    .meta({ path: "/firewall/decisions", tag, method: "GET" })
    .output(z.array(firewallDecisionSchema)),

  blocklists: {
    list: oc
      .meta({ path: "/firewall/blocklists", tag, method: "GET" })
      .output(blocklistListSchema),
    addCustom: oc
      .errors({ CONFLICT: blocklistErrors.CONFLICT, INVALID_INPUT: blocklistErrors.INVALID_INPUT })
      .meta({ path: "/firewall/blocklists", tag, method: "POST" })
      .input(
        z.object({
          name: z.string().min(1).max(80),
          url: z.string().url(),
          durationHours: z.number().int().min(1).max(720).default(24),
          intervalMinutes: z.number().int().min(15).max(10080).default(360),
        }),
      )
      .output(blocklistSchema),
    enableCatalog: oc
      .errors({ CONFLICT: blocklistErrors.CONFLICT, INVALID_INPUT: blocklistErrors.INVALID_INPUT })
      .meta({ path: "/firewall/blocklists/catalog", tag, method: "POST" })
      .input(z.object({ slug: z.string() }))
      .output(blocklistSchema),
    toggle: oc
      .errors({ NOT_FOUND: blocklistErrors.NOT_FOUND })
      .meta({ path: "/firewall/blocklists/{id}/toggle", tag, method: "POST" })
      .input(z.object({ id: z.string(), enabled: z.boolean() }))
      .output(blocklistSchema),
    remove: oc
      .errors({ NOT_FOUND: blocklistErrors.NOT_FOUND })
      .meta({ path: "/firewall/blocklists/{id}", tag, method: "DELETE" })
      .input(z.object({ id: z.string() }))
      .output(z.object({ ok: z.boolean() })),
    syncNow: oc
      .errors({ NOT_FOUND: blocklistErrors.NOT_FOUND })
      .meta({ path: "/firewall/blocklists/{id}/sync", tag, method: "POST" })
      .input(z.object({ id: z.string() }))
      .output(syncResultSchema),
  },

  console: {
    status: oc
      .meta({ path: "/firewall/console", tag, method: "GET" })
      .output(consoleStatusSchema),
    enroll: oc
      .errors({ INVALID_INPUT: { status: 422, message: "Enrollment failed" as const } })
      .meta({ path: "/firewall/console/enroll", tag, method: "POST" })
      .input(z.object({ key: z.string().min(8).max(120) }))
      .output(z.object({ ok: z.boolean(), message: z.string() })),
  },
};
