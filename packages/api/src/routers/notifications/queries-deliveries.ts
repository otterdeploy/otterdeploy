import type {
  NotificationChannelId,
  NotificationDeliveryId,
  OrganizationId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { notificationDelivery } from "@otterdeploy/db/schema";
/**
 * Per-channel delivery-history queries (the card's "Deliveries" dialog) —
 * split from queries.ts, which holds the channel CRUD + stats presenter.
 */
import { and, desc, eq, sql } from "drizzle-orm";

export interface DeliveryBreakdownRow {
  /** Catalog event id, or "test.ping" for test sends. */
  eventId: string;
  delivered: number;
  failed: number;
}

export interface DeliveryItem {
  id: NotificationDeliveryId;
  eventId: string;
  status: "delivered" | "failed";
  error: string | null;
  createdAt: Date;
}

/** Per-event delivered/failed counts over the last 7 days for one channel. */
export async function deliveryBreakdown7d(input: {
  organizationId: OrganizationId;
  channelId: NotificationChannelId;
}): Promise<DeliveryBreakdownRow[]> {
  return db
    .select({
      eventId: notificationDelivery.eventId,
      delivered:
        sql<number>`count(*) filter (where ${notificationDelivery.status} = 'delivered')`.mapWith(
          Number,
        ),
      failed:
        sql<number>`count(*) filter (where ${notificationDelivery.status} = 'failed')`.mapWith(
          Number,
        ),
    })
    .from(notificationDelivery)
    .where(
      and(
        eq(notificationDelivery.organizationId, input.organizationId),
        eq(notificationDelivery.channelId, input.channelId),
        sql`${notificationDelivery.createdAt} >= now() - interval '7 days'`,
      ),
    )
    .groupBy(notificationDelivery.eventId)
    .orderBy(sql`count(*) desc`);
}

/**
 * One page of a channel's delivery log, newest first. Keyset pagination on
 * (createdAt, id): the cursor is the last row's id, resolved to its full-
 * precision timestamp inside the query (a JS Date round-trip would truncate
 * the µs and could skip same-millisecond rows).
 */
export async function listDeliveries(input: {
  organizationId: OrganizationId;
  channelId: NotificationChannelId;
  limit: number;
  cursor?: NotificationDeliveryId;
}): Promise<{ items: DeliveryItem[]; nextCursor: NotificationDeliveryId | null }> {
  const conds = [
    eq(notificationDelivery.organizationId, input.organizationId),
    eq(notificationDelivery.channelId, input.channelId),
  ];
  if (input.cursor) {
    // Row-wise comparison against the cursor row. A stale/foreign cursor makes
    // the subquery return NULL → no rows → an honest empty page.
    conds.push(
      sql`(${notificationDelivery.createdAt}, ${notificationDelivery.id}) < (select ${notificationDelivery.createdAt}, ${notificationDelivery.id} from ${notificationDelivery} where ${notificationDelivery.id} = ${input.cursor} and ${notificationDelivery.organizationId} = ${input.organizationId})`,
    );
  }
  // Fetch one extra row to learn whether another page exists.
  const rows = await db
    .select({
      id: notificationDelivery.id,
      eventId: notificationDelivery.eventId,
      status: notificationDelivery.status,
      error: notificationDelivery.error,
      createdAt: notificationDelivery.createdAt,
    })
    .from(notificationDelivery)
    .where(and(...conds))
    .orderBy(desc(notificationDelivery.createdAt), desc(notificationDelivery.id))
    .limit(input.limit + 1);

  const items = rows.slice(0, input.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > input.limit && last ? last.id : null;
  return { items, nextCursor };
}
