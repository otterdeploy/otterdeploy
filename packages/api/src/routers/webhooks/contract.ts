/**
 * Webhooks oRPC contract — outbound webhooks (we POST signed events out),
 * their delivery log, and inbound trigger endpoints (unique URLs external
 * systems call in). Mirrors the notifications contract idioms: branded
 * `zId(...)` inputs, hand-rolled output schemas (rows carry computed delivery
 * stats, never a secret — secrets go through explicit `reveal` procedures or
 * the create-once response), stable tag/basePath.
 *
 * Event vocabulary = the notifications PLATFORM_EVENTS catalog (one
 * vocabulary across notification channels and webhooks).
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { EVENT_IDS } from "../notifications/events";
import { isValidAllowlistEntry } from "./inbound-guard";

const tag = "webhooks";
const basePath = "/webhooks";

const webhookIdField = zId(ID_PREFIX.webhook);
const inboundEndpointIdField = zId(ID_PREFIX.inboundEndpoint);
const resourceIdField = zId(ID_PREFIX.resource);

const eventId = z.enum(EVENT_IDS as [string, ...string[]]);

// Display status — `failing` is derived from recent delivery failures on an
// active webhook, never stored.
const webhookStatus = z.enum(["active", "paused", "failing"]);
const inboundStatus = z.enum(["active", "paused"]);
const inboundAction = z.enum(["redeploy", "none"]);

const ipAllowlist = z
  .array(
    z
      .string()
      .max(64)
      .refine(isValidAllowlistEntry, "Must be an IP address or IPv4 CIDR (e.g. 140.82.112.0/20)"),
  )
  .max(64);

// ─── Output schemas ──────────────────────────────────────────────────────

/** An outbound webhook as the UI sees it — stats included, secret never. */
const webhookSchema = z.object({
  id: webhookIdField,
  url: z.string(),
  events: z.array(eventId),
  status: webhookStatus,
  totalDeliveries: z.number(),
  /** Percent of attempts that succeeded, 0–100. Null until first delivery. */
  successRate: z.number().nullable(),
  lastDelivery: z.string().nullable(),
  failed24h: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const deliverySchema = z.object({
  id: zId(ID_PREFIX.webhookDelivery),
  webhookId: webhookIdField,
  /** Hostname of the webhook URL — the "Target" column. */
  target: z.string(),
  event: z.string(),
  statusCode: z.number().nullable(),
  ok: z.boolean(),
  attempt: z.number(),
  latencyMs: z.number(),
  error: z.string().nullable(),
  createdAt: z.date(),
});

/** An inbound endpoint — token is card-visible (it's in the URL); the HMAC
 * secret is not (create-once response or `reveal`). */
const inboundEndpointSchema = z.object({
  id: inboundEndpointIdField,
  name: z.string(),
  token: z.string(),
  action: inboundAction,
  resourceId: resourceIdField.nullable(),
  /** Bound service's display name + project slug, when the action targets one. */
  resourceName: z.string().nullable(),
  projectSlug: z.string().nullable(),
  ipAllowlist: z.array(z.string()),
  lastInvokedAt: z.string().nullable(),
  status: inboundStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** A service a redeploy endpoint can target (org-wide picker). */
const serviceOptionSchema = z.object({
  resourceId: resourceIdField,
  name: z.string(),
  projectName: z.string(),
  projectSlug: z.string(),
});

const secretSchema = z.object({ secret: z.string() });
const testResultSchema = z.object({ message: z.string() });

// ─── Inputs ────────────────────────────────────────────────────────────

const webhookNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Webhook not found" as const },
};
const endpointNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Endpoint not found" as const },
};

const createWebhookInput = z.object({
  url: z.string().url().max(2048),
  events: z.array(eventId).min(1),
});

const updateWebhookInput = z.object({
  id: webhookIdField,
  url: z.string().url().max(2048).optional(),
  events: z.array(eventId).min(1).optional(),
});

const webhookIdInput = z.object({ id: webhookIdField });

const createInboundInput = z.object({
  name: z.string().min(1).max(120),
  action: inboundAction,
  // Required when action = "redeploy"; refined in the handler (needs DB).
  resourceId: resourceIdField.optional(),
  ipAllowlist: ipAllowlist.default([]),
});

const updateInboundInput = z.object({
  id: inboundEndpointIdField,
  name: z.string().min(1).max(120).optional(),
  action: inboundAction.optional(),
  // Explicit null clears the binding.
  resourceId: resourceIdField.nullable().optional(),
  ipAllowlist: ipAllowlist.optional(),
});

const inboundIdInput = z.object({ id: inboundEndpointIdField });

// ─── Contract ────────────────────────────────────────────────────────────

export const webhooksContract = {
  outbound: {
    list: oc
      .route({ method: "GET", path: `${basePath}/outbound`, tags: [tag] })
      .output(z.array(webhookSchema)),

    create: oc
      .route({ method: "POST", path: `${basePath}/outbound`, tags: [tag] })
      .input(createWebhookInput)
      .output(webhookSchema),

    update: oc
      .route({ method: "PATCH", path: `${basePath}/outbound`, tags: [tag] })
      .input(updateWebhookInput)
      .output(webhookSchema)
      .errors(webhookNotFound),

    delete: oc
      .route({ method: "DELETE", path: `${basePath}/outbound`, tags: [tag] })
      .input(webhookIdInput)
      .output(webhookIdInput)
      .errors(webhookNotFound),

    pause: oc
      .route({ method: "POST", path: `${basePath}/outbound/pause`, tags: [tag] })
      .input(webhookIdInput)
      .output(webhookSchema)
      .errors(webhookNotFound),

    /** Queue a signed `test.ping` delivery to this webhook. */
    test: oc
      .route({ method: "POST", path: `${basePath}/outbound/test`, tags: [tag] })
      .input(webhookIdInput)
      .output(testResultSchema)
      .errors(webhookNotFound),

    /** Decrypt and return the HMAC signing secret (eye-reveal on the card). */
    reveal: oc
      .route({ method: "POST", path: `${basePath}/outbound/reveal`, tags: [tag] })
      .input(webhookIdInput)
      .output(secretSchema)
      .errors(webhookNotFound),
  },

  deliveries: {
    /** Most recent delivery attempts across the org (newest first). */
    list: oc
      .route({ method: "GET", path: `${basePath}/deliveries`, tags: [tag] })
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
      .output(z.array(deliverySchema)),
  },

  inbound: {
    list: oc
      .route({ method: "GET", path: `${basePath}/inbound`, tags: [tag] })
      .output(z.array(inboundEndpointSchema)),

    /** Mints token + secret server-side; the plaintext secret is returned
     * ONLY here. */
    create: oc
      .route({ method: "POST", path: `${basePath}/inbound`, tags: [tag] })
      .input(createInboundInput)
      .output(z.object({ endpoint: inboundEndpointSchema, secret: z.string() })),

    update: oc
      .route({ method: "PATCH", path: `${basePath}/inbound`, tags: [tag] })
      .input(updateInboundInput)
      .output(inboundEndpointSchema)
      .errors(endpointNotFound),

    delete: oc
      .route({ method: "DELETE", path: `${basePath}/inbound`, tags: [tag] })
      .input(inboundIdInput)
      .output(inboundIdInput)
      .errors(endpointNotFound),

    pause: oc
      .route({ method: "POST", path: `${basePath}/inbound/pause`, tags: [tag] })
      .input(inboundIdInput)
      .output(inboundEndpointSchema)
      .errors(endpointNotFound),

    reveal: oc
      .route({ method: "POST", path: `${basePath}/inbound/reveal`, tags: [tag] })
      .input(inboundIdInput)
      .output(secretSchema)
      .errors(endpointNotFound),

    /** Services a redeploy endpoint can bind to (org-wide). */
    serviceOptions: oc
      .route({ method: "GET", path: `${basePath}/inbound/services`, tags: [tag] })
      .output(z.array(serviceOptionSchema)),
  },
};
