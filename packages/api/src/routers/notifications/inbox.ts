/**
 * In-app inbox queries: the session user's own `notification` rows (written
 * by the `notification.send` job), scoped to the active org plus account-level
 * (org-null) rows. Split from queries.ts, which holds the channel/subscription
 * queries. All writes are guarded by userId so one user can never mark
 * another's rows.
 */
import type { NotificationId, OrganizationId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { db } from "@otterdeploy/db";
import { type NotificationRow, notification } from "@otterdeploy/db/schema";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { deriveOpenConditions, type OpenCondition } from "../../notifications/conditions";

/**
 * How far back to look for open conditions, in rows. A condition is decided
 * by the newest row of its key, so the window only has to reach past the
 * newest row of every key the operator could still care about; three hundred
 * covers weeks of a busy install and the query is indexed by (user, created).
 */
const CONDITION_LOOKBACK = 300;

export interface InboxItem {
  id: NotificationId;
  title: string;
  message: string;
  /** Structured context from the fan-out (eventId + display strings); null for
   *  plain sends. Surfaced so the client can render the severity + detail rows. */
  data: JsonObject | null;
  readAt: Date | null;
  createdAt: Date;
}

interface InboxScope {
  userId: string;
  organizationId: OrganizationId;
}

/** This user's rows visible in this org: org-scoped + account-level. */
function scopeWhere(scope: InboxScope) {
  return and(
    eq(notification.userId, scope.userId),
    or(isNull(notification.organizationId), eq(notification.organizationId, scope.organizationId)),
  );
}

function toItem(row: NotificationRow): InboxItem {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    data: row.data ?? null,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * The inbox as two lists: what is still open, and settled history.
 *
 * Rows an open condition folded are returned inside it and NOT in `items`,
 * so a failure is one card rather than a card plus twenty rows underneath.
 */
export async function listInbox(
  scope: InboxScope,
  limit: number,
): Promise<{ open: OpenCondition<NotificationId>[]; items: InboxItem[]; unread: number }> {
  const [rows, [unreadRow]] = await Promise.all([
    db
      .select()
      .from(notification)
      .where(scopeWhere(scope))
      .orderBy(desc(notification.createdAt))
      .limit(Math.max(limit, CONDITION_LOOKBACK)),
    db
      .select({ unread: count() })
      .from(notification)
      .where(and(scopeWhere(scope), isNull(notification.readAt))),
  ]);
  const items = rows.map(toItem);
  const { open, consumed } = deriveOpenConditions(items);
  return {
    open,
    items: items.filter((item) => !consumed.has(item.id)).slice(0, limit),
    unread: unreadRow?.unread ?? 0,
  };
}

/** Idempotent: an already-read row keeps its original readAt. */
export async function markInboxRead(scope: InboxScope, id: NotificationId): Promise<void> {
  await db
    .update(notification)
    .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
    .where(and(eq(notification.id, id), eq(notification.userId, scope.userId)));
}

/** Idempotent for the same reason as {@link markInboxRead}; guarded by user. */
export async function markInboxReadMany(
  scope: InboxScope,
  ids: readonly NotificationId[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(notification)
    .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
    .where(
      and(
        inArray(notification.id, [...ids]),
        eq(notification.userId, scope.userId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

export async function markInboxAllRead(scope: InboxScope): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(scopeWhere(scope), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length;
}
