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

/** An IP or CIDR range. Kept deliberately loose (cscli does the real
 *  validation); the charset just rejects obvious junk / shell metacharacters. */
const ipValue = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, "Enter a valid IP address or CIDR range.");

const blockResultSchema = z.object({
  ok: z.boolean(),
  /** Human-readable failure (agent down, cscli error) — null on success. */
  error: z.string().nullable(),
});

/** A client IP flagged for scanner-style probing of the org's domains. */
const flaggedIpSchema = z.object({
  ip: z.string(),
  country: z.string().nullable(),
  /** Suspicious requests from this IP in the window. */
  count: z.number(),
  /** ISO-8601 timestamp of the most recent probe. */
  lastSeen: z.string(),
  /** Up to 5 distinct probe paths, for context. */
  samplePaths: z.array(z.string()),
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
  status: oc.meta({ path: "/firewall/status", tag, method: "GET" }).output(firewallStatusSchema),
  decisions: oc
    .meta({ path: "/firewall/decisions", tag, method: "GET" })
    .output(z.array(firewallDecisionSchema)),
  /** Ban a single IP / CIDR (manual CrowdSec decision). No Caddy reload needed. */
  block: oc
    .meta({ path: "/firewall/decisions/block", tag, method: "POST" })
    .input(
      z.object({
        ip: ipValue,
        /** Ban length in hours. Default 30 days. */
        durationHours: z.number().int().min(1).max(8760).default(720),
        /** Free-text note; defaults to `manual:<actorId>` in the handler. */
        reason: z.string().max(120).optional(),
      }),
    )
    .output(blockResultSchema),
  /** Ban a batch of IPs in one shot — the "block all suspicious" action. */
  blockMany: oc
    .meta({ path: "/firewall/decisions/block-many", tag, method: "POST" })
    .input(
      z.object({
        ips: z.array(ipValue).min(1).max(100),
        durationHours: z.number().int().min(1).max(8760).default(720),
        reason: z.string().max(120).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean(), blocked: z.number(), error: z.string().nullable() })),
  /** Remove every decision targeting an IP (undo a manual block). */
  unblock: oc
    .meta({ path: "/firewall/decisions/unblock", tag, method: "POST" })
    .input(z.object({ ip: ipValue }))
    .output(blockResultSchema),
  /** Client IPs probing the org's domains with scanner-style paths — the
   *  "review these IPs" panel, one-click blockable. */
  flagged: oc
    .meta({ path: "/firewall/flagged", tag, method: "GET" })
    .input(z.object({ windowMinutes: z.number().int().min(5).max(1440).default(60) }))
    .output(z.array(flaggedIpSchema)),

  blocklists: {
    list: oc.meta({ path: "/firewall/blocklists", tag, method: "GET" }).output(blocklistListSchema),
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
    status: oc.meta({ path: "/firewall/console", tag, method: "GET" }).output(consoleStatusSchema),
    enroll: oc
      .errors({ INVALID_INPUT: { status: 422, message: "Enrollment failed" as const } })
      .meta({ path: "/firewall/console/enroll", tag, method: "POST" })
      .input(z.object({ key: z.string().min(8).max(120) }))
      .output(z.object({ ok: z.boolean(), message: z.string() })),
  },
};
