/**
 * In-app inbox fan-out for platform events: the header bell's data source.
 *
 * Every real (non-test) platform event writes one `notification` row per org
 * member, so the event shows up in every member's in-app inbox. By default,
 * with zero configuration. The events carried here (deploys, backups, certs,
 * health) are the same org-visible operational state the dashboard already
 * shows, no role gate.
 *
 * od-1kc.5: this used to be gated behind `subscribedChannelCount > 0`, the
 * SAME subscription-matrix gate that decides Slack/email/webhook delivery.
 * In-app isn't one of the `notification_channel_config.kind` options
 * (slack/discord/email/webhook/telegram/pagerduty/push, see
 * packages/db/src/schema/notification-channel.ts); it was never meant to be
 * an opt-in row in that matrix, so a fresh org with zero external channels
 * configured (the common case, nobody's wired Slack on day one) got a
 * permanently empty bell despite the inbox's own empty state promising
 * "Deploy, build, and backup events land here." Two real deploys + a restart
 * produced zero items because of exactly this gate.
 *
 * Spam guards:
 *   - `test.ping` / test-mode deliveries never reach the inbox.
 *   - writes are deduped on an occurrence key (the BullMQ job id, stable
 *     across retries) stored in the row's `data`, so a retried job can't
 *     double-write. The write runs BEFORE channel delivery for the same
 *     reason: a channel failure retries the job, and the dedupe absorbs it.
 */
import { db } from "@otterdeploy/db";
import { member, notification } from "@otterdeploy/db/schema";
import { eq, sql } from "drizzle-orm";

import { publishOrgEvent } from "../org-events";

export interface InboxFanoutEvent {
  organizationId: string;
  eventId: string;
  title: string;
  message: string;
  data?: Record<string, string>;
}

/**
 * Pure gate: fan out in-app for every real (non-test) platform event:
 * unconditionally, independent of whether the org has any external channel
 * subscribed. See the module doc for why this must NOT depend on the
 * external-channel subscription matrix. `subscribedChannelCount` is no
 * longer read by the gate itself; callers still pass it so the signature
 * matches the event job's existing call site without forcing a second
 * unrelated diff.
 */
export function shouldFanOutInApp(input: {
  eventId: string;
  testChannelId: string | undefined;
  subscribedChannelCount: number;
}): boolean {
  if (input.testChannelId) return false;
  if (input.eventId === "test.ping") return false;
  return true;
}

/** Row payloads for one event occurrence: pure, so the mapping is testable. */
export function inboxRowsFor(
  event: InboxFanoutEvent,
  userIds: readonly string[],
  occurrenceKey: string,
): Array<{
  userId: string;
  organizationId: string;
  channel: "in-app";
  title: string;
  message: string;
  data: Record<string, string>;
}> {
  return userIds.map((userId) => ({
    userId,
    organizationId: event.organizationId,
    channel: "in-app" as const,
    title: event.title,
    message: event.message,
    data: { ...event.data, eventId: event.eventId, occurrence: occurrenceKey },
  }));
}

/**
 * Write the in-app rows for one event occurrence. Idempotent per
 * `occurrenceKey`: if any row for this occurrence already exists (a previous
 * attempt of the same job got this far), nothing is written.
 * Returns the number of rows written.
 */
export async function writeInboxRows(
  event: InboxFanoutEvent,
  occurrenceKey: string,
): Promise<number> {
  const [existing] = await db
    .select({ id: notification.id })
    .from(notification)
    .where(sql`${notification.data} ->> 'occurrence' = ${occurrenceKey}`)
    .limit(1);
  if (existing) return 0;

  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, event.organizationId));
  if (members.length === 0) return 0;

  const rows = inboxRowsFor(
    event,
    members.map((m) => m.userId),
    occurrenceKey,
  );
  await db.insert(notification).values(rows);
  // Rows exist now. Announce so open tabs resync the bell instead of
  // waiting out the inbox poll backstop.
  publishOrgEvent(event.organizationId, "inbox");
  return rows.length;
}
