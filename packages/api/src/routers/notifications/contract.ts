/**
 * Notification channels oRPC contract. Mirrors the backups contract: branded
 * `zId(...)` inputs, hand-rolled output schemas (channels carry computed
 * delivery stats + a masked target, never the secret), a stable tag/basePath
 * for the OpenAPI doc.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { EVENT_IDS } from "./events";

const tag = "notifications";
const basePath = "/notifications";

const channelIdField = zId(ID_PREFIX.notificationChannel);

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
};
