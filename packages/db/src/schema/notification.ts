import type { NotificationId } from "@otterdeploy/shared/id";

/**
 * In-app notifications — one row per delivered notification to a user. The
 * `notification.send` job writes these; the web client reads the unread feed
 * and marks them read. `push`/`sms` channels are delivered through external
 * providers (see packages/jobs/src/jobs/notification.ts) and still leave an
 * in-app row for the activity feed.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const notificationChannelEnum = pgEnum("notification_channel", ["in-app", "push", "sms"]);

export const notification = pgTable(
  "notification",
  {
    id: text("id")
      .primaryKey()
      .$type<NotificationId>()
      .$defaultFn(() => createId(ID_PREFIX.notification)),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Tenant scope — nullable for account-level (non-org) notifications.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    channel: notificationChannelEnum("channel").notNull().default("in-app"),

    title: text("title").notNull(),
    message: text("message").notNull(),

    // Optional deep-link / structured payload for the client.
    data: jsonb("data").$type<Record<string, unknown>>(),

    // Null until the user reads it.
    readAt: timestamp("read_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Primary query: a user's feed, newest first.
    index("notification_user_created_idx").on(t.userId, t.createdAt),
    index("notification_user_unread_idx").on(t.userId, t.readAt),
  ],
);

export type NotificationRow = typeof notification.$inferSelect;
export type NewNotificationRow = typeof notification.$inferInsert;
