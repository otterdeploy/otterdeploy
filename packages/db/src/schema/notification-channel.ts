/**
 * Notification channels — the routing config that fans platform events
 * (deploy / build / health / cert / backup / ssh / audit) out to Slack,
 * Discord, email, webhooks, Telegram, and PagerDuty. Distinct from the
 * `notification` table (./notification.ts), which is the per-user in-app feed.
 *
 *   notification_channel — one row per configured destination. `config` holds
 *     non-secret params (webhook URL, recipient address, SMTP host, telegram
 *     chat id, pagerduty routing details); `encryptedSecret` is the AES-GCM
 *     ciphertext for the sensitive half (bot token, HMAC signing secret) —
 *     base64url, never logged (see packages/api/src/lib/crypto.ts).
 *
 *   notification_subscription — the event→channel routing grid. One row per
 *     (channel, eventId) the channel is subscribed to. Toggling a matrix cell
 *     inserts/deletes a row. `eventId` is a stable catalog string (e.g.
 *     "deploy.failed") owned by the API, not an FK.
 *
 *   notification_delivery — append-only delivery log. Powers the per-channel
 *     stats on the card (events in 7d, last delivery, recent failures → the
 *     "degraded" pill). The effective display status is derived from this, not
 *     stored on the channel.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import type {
  NotificationChannelId,
  NotificationDeliveryId,
  NotificationSubscriptionId,
  OrganizationId,
} from "@otterdeploy/shared/id";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const notificationChannelKindEnum = pgEnum("notification_channel_kind", [
  "slack",
  "discord",
  "email",
  "webhook",
  "telegram",
  "pagerduty",
  "push",
]);

/**
 * Operator-controlled lifecycle state. `degraded` is NOT stored here — it's
 * derived from recent delivery failures in the presenter. `disconnected` means
 * the channel was created but never confirmed (e.g. a Telegram bot that hasn't
 * been linked).
 */
export const notificationChannelStatusEnum = pgEnum(
  "notification_channel_status",
  ["active", "paused", "disconnected"],
);

export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["delivered", "failed"],
);

// ---------------------------------------------------------------------------
// notification_channel — one configured destination
// ---------------------------------------------------------------------------

// NB: the physical table is `notification_channel_config`, not
// `notification_channel` — the latter name is already taken by the in-app
// delivery-method enum (pgEnum "notification_channel" in ./notification.ts),
// and Postgres won't let a table and a type share a name.
export const notificationChannel = pgTable(
  "notification_channel_config",
  {
    id: text("id")
      .primaryKey()
      .$type<NotificationChannelId>()
      .$defaultFn(() => createId(ID_PREFIX.notificationChannel)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: notificationChannelKindEnum("kind").notNull(),
    name: text("name").notNull(),
    // Primary destination string (webhook URL, recipient email, telegram chat
    // id). Non-secret — masked for display in the presenter, stored whole.
    target: text("target").notNull(),
    // Human-readable transport descriptor shown on the card
    // (e.g. "incoming-webhook", "POST · HMAC-SHA256", "SMTP via Resend").
    transport: text("transport").notNull(),
    // Non-secret extra params (smtp host/from, pagerduty severity, …).
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // AES-GCM ciphertext for the sensitive half (bot token, HMAC secret).
    encryptedSecret: text("encrypted_secret"),
    status: notificationChannelStatusEnum("status")
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("notification_channel_org_idx").on(table.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// notification_subscription — event→channel routing grid
// ---------------------------------------------------------------------------

export const notificationSubscription = pgTable(
  "notification_subscription",
  {
    id: text("id")
      .primaryKey()
      .$type<NotificationSubscriptionId>()
      .$defaultFn(() => createId(ID_PREFIX.notificationSubscription)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .$type<NotificationChannelId>()
      .references(() => notificationChannel.id, { onDelete: "cascade" }),
    // Stable event catalog id (e.g. "deploy.failed"). Owned by the API, not FK.
    eventId: text("event_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // A channel subscribes to a given event at most once.
    uniqueIndex("notification_subscription_channel_event_idx").on(
      table.channelId,
      table.eventId,
    ),
    // Fan-out query: every channel subscribed to (org, event).
    index("notification_subscription_org_event_idx").on(
      table.organizationId,
      table.eventId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// notification_delivery — append-only delivery log (powers card stats)
// ---------------------------------------------------------------------------

export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: text("id")
      .primaryKey()
      .$type<NotificationDeliveryId>()
      .$defaultFn(() => createId(ID_PREFIX.notificationDelivery)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .$type<NotificationChannelId>()
      .references(() => notificationChannel.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    status: notificationDeliveryStatusEnum("status").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Per-channel stats window (events in 7d, last delivery, recent failures).
    index("notification_delivery_channel_created_idx").on(
      table.channelId,
      table.createdAt,
    ),
  ],
);

export type NotificationChannelRow = typeof notificationChannel.$inferSelect;
export type NewNotificationChannelRow = typeof notificationChannel.$inferInsert;
export type NotificationSubscriptionRow =
  typeof notificationSubscription.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;
