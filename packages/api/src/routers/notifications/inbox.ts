/**
 * In-app inbox queries — the session user's own `notification` rows (written
 * by the `notification.send` job), scoped to the active org plus account-level
 * (org-null) rows. Split from queries.ts, which holds the channel/subscription
 * queries. All writes are guarded by userId so one user can never mark
 * another's rows.
 */
import type { NotificationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { type NotificationRow, notification } from "@otterdeploy/db/schema";
import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";

export interface InboxItem {
  id: NotificationId;
  title: string;
  message: string;
  /** Structured context from the fan-out (eventId + display strings); null for
   *  plain sends. Surfaced so the client can render the severity + detail rows. */
  data: Record<string, unknown> | null;
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

export async function listInbox(
  scope: InboxScope,
  limit: number,
): Promise<{ items: InboxItem[]; unread: number }> {
  const [rows, [unreadRow]] = await Promise.all([
    db
      .select()
      .from(notification)
      .where(scopeWhere(scope))
      .orderBy(desc(notification.createdAt))
      .limit(limit),
    db
      .select({ unread: count() })
      .from(notification)
      .where(and(scopeWhere(scope), isNull(notification.readAt))),
  ]);
  return { items: rows.map(toItem), unread: unreadRow?.unread ?? 0 };
}

/** Idempotent: an already-read row keeps its original readAt. */
export async function markInboxRead(scope: InboxScope, id: NotificationId): Promise<void> {
  await db
    .update(notification)
    .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
    .where(and(eq(notification.id, id), eq(notification.userId, scope.userId)));
}

export async function markInboxAllRead(scope: InboxScope): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(scopeWhere(scope), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length;
}
