/**
 * Notification channels oRPC contract. Mirrors the backups contract: branded
 * `zId(...)` inputs, hand-rolled output schemas (channels carry computed
 * delivery stats + a masked target, never the secret), a stable tag/basePath
 * for the OpenAPI doc.
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { EVENT_IDS } from "./events";

const tag = "notifications";
const basePath = "/notifications";

const channelIdField = zId(ID_PREFIX.notificationChannel);
const notificationIdField = zId(ID_PREFIX.notification);

const channelKind = z.enum([
  "slack",
  "discord",
  "email",
  "webhook",
  "telegram",
  "pagerduty",
  "push",
]);

// Effective display status — `warn` (degraded) is derived from recent
// delivery failures, not stored.
const channelStatus = z.enum(["active", "paused", "disconnected", "warn"]);

const eventId = z.enum(EVENT_IDS as [string, ...string[]]);

// ─── Output schemas ──────────────────────────────────────────────────────

/** A channel as the UI sees it — masked target, computed stats, no secret. */
const channelSchema = z.object({
  id: channelIdField,
  kind: channelKind,
  name: z.string(),
  /** Masked for display (full value never leaves the server for secrets). */
  target: z.string(),
  transport: z.string(),
  config: z.record(z.string(), z.unknown()),
  status: channelStatus,
  events7d: z.number(),
  lastDelivery: z.string().nullable(),
  failed24h: z.number(),
  /** Human note shown on the card when degraded. */
  note: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const subscriptionSchema = z.object({
  channelId: channelIdField,
  eventId,
});

const deliveryIdField = zId(ID_PREFIX.notificationDelivery);

/** One row of a channel's append-only delivery log. `eventId` is a plain
 * string (not the catalog enum) — test sends log as "test.ping", which is
 * deliberately outside the subscribable catalog. */
const deliveryItemSchema = z.object({
  id: deliveryIdField,
  eventId: z.string(),
  status: z.enum(["delivered", "failed"]),
  /** Provider error for failed attempts, null when delivered. */
  error: z.string().nullable(),
  createdAt: z.date(),
});

/** Per-event delivered/failed counts over the trailing 7 days. */
const deliveryBreakdownSchema = z.object({
  eventId: z.string(),
  delivered: z.number(),
  failed: z.number(),
});

/** One in-app inbox entry — the caller's own `notification` row. */
const inboxItemSchema = z.object({
  id: notificationIdField,
  title: z.string(),
  message: z.string(),
  /**
   * Structured context written by the platform-event fan-out — `eventId` plus
   * display strings (resource, project, deploymentId, …). Drives the severity
   * dot and the expandable detail rows in the header-bell popover. Null for
   * plain `notification.send` rows that carried no payload.
   */
  data: z.record(z.string(), z.unknown()).nullable(),
  /** Null until the user reads it. */
  readAt: z.date().nullable(),
  createdAt: z.date(),
});

// ─── Inputs ────────────────────────────────────────────────────────────

const channelNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Channel not found" as const },
};

const createChannelInput = z.object({
  kind: channelKind,
  name: z.string().min(1).max(120),
  target: z.string().min(1).max(2048),
  transport: z.string().max(120).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  // Sensitive half (bot token, HMAC key, routing key). Encrypted at rest,
  // never returned.
  secret: z.string().max(4096).optional(),
});

const updateChannelInput = z.object({
  id: channelIdField,
  name: z.string().min(1).max(120).optional(),
  target: z.string().min(1).max(2048).optional(),
  transport: z.string().max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  // Omit / empty to leave the stored secret in place.
  secret: z.string().max(4096).optional(),
});

const channelIdInput = z.object({ id: channelIdField });

const toggleSubscriptionInput = z.object({
  channelId: channelIdField,
  eventId,
  enabled: z.boolean(),
});

const testResultSchema = z.object({ message: z.string() });

// ─── Contract ────────────────────────────────────────────────────────────

export const notificationsContract = {
  channels: {
    list: oc
      .route({ method: "GET", path: `${basePath}/channels`, tags: [tag] })
      .output(z.array(channelSchema)),

    create: oc
      .route({ method: "POST", path: `${basePath}/channels`, tags: [tag] })
      .input(createChannelInput)
      .output(channelSchema),

    update: oc
      .route({ method: "PATCH", path: `${basePath}/channels`, tags: [tag] })
      .input(updateChannelInput)
      .output(channelSchema)
      .errors(channelNotFound),

    delete: oc
      .route({ method: "DELETE", path: `${basePath}/channels`, tags: [tag] })
      .input(channelIdInput)
      .output(channelIdInput)
      .errors(channelNotFound),

    pause: oc
      .route({ method: "POST", path: `${basePath}/channels/pause`, tags: [tag] })
      .input(channelIdInput)
      .output(channelSchema)
      .errors(channelNotFound),

    test: oc
      .route({ method: "POST", path: `${basePath}/channels/test`, tags: [tag] })
      .input(channelIdInput)
      .output(testResultSchema)
      .errors(channelNotFound),
  },

  // Per-channel delivery history — powers the "View deliveries" dialog on a
  // channel card. One call returns the 7d per-event breakdown plus a keyset-
  // paginated page of recent deliveries (cursor = last item's id).
  deliveries: oc
    .route({ method: "GET", path: `${basePath}/deliveries`, tags: [tag] })
    .input(
      z.object({
        channelId: channelIdField,
        limit: z.number().int().min(1).max(100).default(50),
        cursor: deliveryIdField.optional(),
      }),
    )
    .output(
      z.object({
        breakdown7d: z.array(deliveryBreakdownSchema),
        items: z.array(deliveryItemSchema),
        /** Pass back as `cursor` to fetch the next page; null = no more. */
        nextCursor: deliveryIdField.nullable(),
      }),
    )
    .errors(channelNotFound),

  subscriptions: {
    list: oc
      .route({ method: "GET", path: `${basePath}/subscriptions`, tags: [tag] })
      .output(z.array(subscriptionSchema)),

    toggle: oc
      .route({ method: "POST", path: `${basePath}/subscriptions`, tags: [tag] })
      .input(toggleSubscriptionInput)
      .output(toggleSubscriptionInput)
      .errors(channelNotFound),
  },

  // The caller's own in-app feed (the header bell's popover). User-scoped —
  // rows belong to the session user, filtered to the active org + account-
  // level rows. One list call carries the unread count so the badge and the
  // popover share a single poll.
  inbox: {
    list: oc
      .route({ method: "GET", path: `${basePath}/inbox`, tags: [tag] })
      .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
      .output(z.object({ items: z.array(inboxItemSchema), unread: z.number() })),

    markRead: oc
      .route({ method: "POST", path: `${basePath}/inbox/read`, tags: [tag] })
      .input(z.object({ id: notificationIdField }))
      .output(z.object({ id: notificationIdField })),

    markAllRead: oc
      .route({ method: "POST", path: `${basePath}/inbox/read-all`, tags: [tag] })
      .output(z.object({ updated: z.number() })),
  },
};
