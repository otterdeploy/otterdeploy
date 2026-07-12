import type {
  InboundEndpointId,
  OrganizationId,
  ResourceId,
  WebhookDeliveryId,
  WebhookId,
} from "@otterdeploy/shared/id";

/**
 * Webhooks — the org's HTTP event surface, both directions. Distinct from
 * notification channels (./notification-channel.ts): a channel routes a
 * human-readable message to a chat/email destination; a webhook delivers the
 * raw signed event payload to a machine, and an inbound endpoint receives one.
 *
 *   webhook — one outbound subscription: a target URL + the platform events it
 *     wants (same catalog ids as notification subscriptions —
 *     packages/api/src/routers/notifications/events.ts). Every payload is
 *     signed with HMAC-SHA256 over the raw body (`X-Otterdeploy-Signature:
 *     sha256=<hex>`); `encryptedSecret` is the AES-GCM ciphertext of the
 *     signing key (packages/jobs/src/delivery/secret-crypto.ts).
 *
 *   webhook_delivery — append-only log, one row PER ATTEMPT (BullMQ retries
 *     write their own rows), powering the card stats (total/success-rate/last)
 *     and the recent-deliveries table (code/attempt/latency).
 *
 *   inbound_endpoint — a unique unauthenticated URL
 *     (`POST /api/webhooks/in/<token>`) external systems call to trigger an
 *     action. Requests must carry a valid HMAC signature for the endpoint's
 *     secret; an optional source-IP allowlist narrows callers further.
 *     `action` = what a verified request does: `redeploy` re-applies the bound
 *     service (same code path as the panel's Redeploy), `none` just records
 *     the invocation.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { resource } from "./project";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Operator-controlled lifecycle state. The UI's `failing` badge is derived
 * from recent delivery failures in the presenter, never stored. */
export const webhookStatusEnum = pgEnum("webhook_status", ["active", "paused"]);

export const inboundEndpointStatusEnum = pgEnum("inbound_endpoint_status", ["active", "paused"]);

export const inboundEndpointActionEnum = pgEnum("inbound_endpoint_action", ["redeploy", "none"]);

// ---------------------------------------------------------------------------
// webhook — one outbound event subscription
// ---------------------------------------------------------------------------

export const webhook = pgTable(
  "webhook",
  {
    id: text("id")
      .primaryKey()
      .$type<WebhookId>()
      .$defaultFn(() => createId(ID_PREFIX.webhook)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // AES-GCM ciphertext of the HMAC signing key. Minted server-side on
    // create; revealable to update-permitted members via `webhooks.reveal`.
    encryptedSecret: text("encrypted_secret").notNull(),
    // Subscribed catalog event ids (e.g. "deploy.failed"). Owned by the API's
    // PLATFORM_EVENTS catalog, not an FK — same idiom as
    // notification_subscription.event_id, just denormalized onto the row.
    events: text("events").array().notNull().default([]),
    status: webhookStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("webhook_org_idx").on(table.organizationId)],
);

// ---------------------------------------------------------------------------
// webhook_delivery — append-only, one row per delivery ATTEMPT
// ---------------------------------------------------------------------------

export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: text("id")
      .primaryKey()
      .$type<WebhookDeliveryId>()
      .$defaultFn(() => createId(ID_PREFIX.webhookDelivery)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .$type<WebhookId>()
      .references(() => webhook.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    // The exact JSON body that was signed and POSTed.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // HTTP status of the response; null when the request never completed
    // (DNS failure, connection refused, timeout).
    statusCode: integer("status_code"),
    ok: boolean("ok").notNull(),
    // 1-based attempt number within the BullMQ retry cycle.
    attempt: integer("attempt").notNull().default(1),
    latencyMs: integer("latency_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Per-webhook card stats (total, success rate, last delivery).
    index("webhook_delivery_webhook_created_idx").on(table.webhookId, table.createdAt),
    // Org-wide recent-deliveries table.
    index("webhook_delivery_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// inbound_endpoint — unique URL that triggers an action when called
// ---------------------------------------------------------------------------

export const inboundEndpoint = pgTable(
  "inbound_endpoint",
  {
    id: text("id")
      .primaryKey()
      .$type<InboundEndpointId>()
      .$defaultFn(() => createId(ID_PREFIX.inboundEndpoint)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Unguessable URL slug: POST /api/webhooks/in/<token>. Not a secret in the
    // credential sense (it's shown on the card), but random enough that the
    // HMAC + allowlist are the real gates, not obscurity.
    token: text("token").notNull(),
    // AES-GCM ciphertext of the HMAC secret callers must sign requests with.
    // Returned in plaintext exactly once, on create.
    encryptedSecret: text("encrypted_secret").notNull(),
    action: inboundEndpointActionEnum("action").notNull().default("redeploy"),
    // The service resource a `redeploy` action targets. SET NULL on resource
    // deletion — the endpoint survives but degrades to "no target" (invoke
    // then records only).
    resourceId: text("resource_id")
      .$type<ResourceId>()
      .references(() => resource.id, { onDelete: "set null" }),
    // Allowed source IPs / IPv4 CIDRs. Empty = any source.
    ipAllowlist: text("ip_allowlist").array().notNull().default([]),
    lastInvokedAt: timestamp("last_invoked_at"),
    status: inboundEndpointStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("inbound_endpoint_token_idx").on(table.token),
    index("inbound_endpoint_org_idx").on(table.organizationId),
  ],
);

export type WebhookRow = typeof webhook.$inferSelect;
export type NewWebhookRow = typeof webhook.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDelivery.$inferSelect;
export type InboundEndpointRow = typeof inboundEndpoint.$inferSelect;
export type NewInboundEndpointRow = typeof inboundEndpoint.$inferInsert;
