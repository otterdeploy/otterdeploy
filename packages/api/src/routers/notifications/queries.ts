import type { NotificationChannelId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  type NotificationChannelRow,
  notificationChannel,
  notificationDelivery,
  notificationSubscription,
} from "@otterdeploy/db/schema";
/**
 * Org-scoped DB queries + presenter for the notification-channels router.
 * Channel rows are enriched with delivery stats (7d count, last delivery,
 * 24h failures) computed from `notification_delivery`, and the secret is never
 * selected into a view. `target` is masked for display.
 */
import { and, eq, sql } from "drizzle-orm";

import { maskChannelTarget } from "./mask-target";

type ChannelKind = NotificationChannelRow["kind"];

export interface ChannelStats {
  events7d: number;
  lastDelivery: Date | null;
  failed24h: number;
}

export interface ChannelView {
  id: NotificationChannelId;
  kind: ChannelKind;
  name: string;
  target: string;
  transport: string;
  config: Record<string, unknown>;
  status: "active" | "paused" | "disconnected" | "warn";
  events7d: number;
  lastDelivery: string | null;
  failed24h: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Reads ─────────────────────────────────────────────────────────────

export async function listChannelRows(
  organizationId: OrganizationId,
): Promise<NotificationChannelRow[]> {
  return db
    .select()
    .from(notificationChannel)
    .where(eq(notificationChannel.organizationId, organizationId))
    .orderBy(notificationChannel.createdAt);
}

export async function getChannelRow(input: {
  organizationId: OrganizationId;
  id: NotificationChannelId;
}): Promise<NotificationChannelRow | null> {
  const [row] = await db
    .select()
    .from(notificationChannel)
    .where(
      and(
        eq(notificationChannel.id, input.id),
        eq(notificationChannel.organizationId, input.organizationId),
      ),
    );
  return row ?? null;
}

/** Per-channel delivery stats for an org, keyed by channel id. */
export async function statsByChannel(
  organizationId: OrganizationId,
): Promise<Map<string, ChannelStats>> {
  const rows = await db
    .select({
      channelId: notificationDelivery.channelId,
      events7d:
        sql<number>`count(*) filter (where ${notificationDelivery.createdAt} >= now() - interval '7 days')`.mapWith(
          Number,
        ),
      lastDelivery: sql<Date | null>`max(${notificationDelivery.createdAt})`,
      failed24h:
        sql<number>`count(*) filter (where ${notificationDelivery.status} = 'failed' and ${notificationDelivery.createdAt} >= now() - interval '24 hours')`.mapWith(
          Number,
        ),
    })
    .from(notificationDelivery)
    .where(eq(notificationDelivery.organizationId, organizationId))
    .groupBy(notificationDelivery.channelId);

  const map = new Map<string, ChannelStats>();
  for (const r of rows) {
    map.set(r.channelId, {
      events7d: r.events7d,
      lastDelivery: r.lastDelivery ? new Date(r.lastDelivery) : null,
      failed24h: r.failed24h,
    });
  }
  return map;
}

export async function listSubscriptionRows(organizationId: OrganizationId) {
  return db
    .select({
      channelId: notificationSubscription.channelId,
      eventId: notificationSubscription.eventId,
    })
    .from(notificationSubscription)
    .where(eq(notificationSubscription.organizationId, organizationId));
}

// ─── Delivery history (per-channel dialog) ─────────────────────────────
// Lives in queries-deliveries.ts; re-exported so the router's single
// import site stays stable.

export {
  deliveryBreakdown7d,
  listDeliveries,
  type DeliveryBreakdownRow,
  type DeliveryItem,
} from "./queries-deliveries";

// ─── Writes ────────────────────────────────────────────────────────────

export async function insertChannel(values: {
  organizationId: OrganizationId;
  kind: ChannelKind;
  name: string;
  target: string;
  transport: string;
  config: Record<string, unknown>;
  encryptedSecret: string | null;
}): Promise<NotificationChannelRow> {
  const [row] = await db.insert(notificationChannel).values(values).returning();
  if (!row) {
    throw new Error("insertChannel: insert returned no row");
  }
  return row;
}

export async function updateChannel(
  input: { organizationId: OrganizationId; id: NotificationChannelId },
  patch: Partial<{
    name: string;
    target: string;
    transport: string;
    config: Record<string, unknown>;
    encryptedSecret: string | null;
    status: "active" | "paused" | "disconnected";
  }>,
): Promise<NotificationChannelRow | null> {
  const [row] = await db
    .update(notificationChannel)
    .set(patch)
    .where(
      and(
        eq(notificationChannel.id, input.id),
        eq(notificationChannel.organizationId, input.organizationId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteChannel(input: {
  organizationId: OrganizationId;
  id: NotificationChannelId;
}): Promise<boolean> {
  const rows = await db
    .delete(notificationChannel)
    .where(
      and(
        eq(notificationChannel.id, input.id),
        eq(notificationChannel.organizationId, input.organizationId),
      ),
    )
    .returning({ id: notificationChannel.id });
  return rows.length > 0;
}

export async function addSubscription(input: {
  organizationId: OrganizationId;
  channelId: NotificationChannelId;
  eventId: string;
}): Promise<void> {
  await db
    .insert(notificationSubscription)
    .values(input)
    .onConflictDoNothing({
      target: [notificationSubscription.channelId, notificationSubscription.eventId],
    });
}

export async function removeSubscription(input: {
  organizationId: OrganizationId;
  channelId: NotificationChannelId;
  eventId: string;
}): Promise<void> {
  await db
    .delete(notificationSubscription)
    .where(
      and(
        eq(notificationSubscription.channelId, input.channelId),
        eq(notificationSubscription.eventId, input.eventId),
      ),
    );
}

// ─── Presenter ───────────────────────────────────────────────────────────

export function toChannelView(
  row: NotificationChannelRow,
  stats: ChannelStats | undefined,
): ChannelView {
  const events7d = stats?.events7d ?? 0;
  const failed24h = stats?.failed24h ?? 0;
  const lastDelivery = stats?.lastDelivery ?? null;

  // Effective status: stored paused/disconnected win; otherwise recent
  // failures degrade an active channel to `warn`.
  let status: ChannelView["status"] = row.status;
  let note: string | null = null;
  if (row.status === "active" && failed24h > 0) {
    status = "warn";
    note = `${failed24h} failed deliver${failed24h === 1 ? "y" : "ies"} in 24h`;
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    // Identity-preserving mask: emails/chat ids show whole, webhook URLs keep
    // origin+path with tokens hidden, routing keys/device tokens stay masked.
    target: maskChannelTarget(row.kind, row.target),
    transport: row.transport,
    config: row.config ?? {},
    status,
    events7d,
    lastDelivery: lastDelivery ? lastDelivery.toISOString() : null,
    failed24h,
    note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
