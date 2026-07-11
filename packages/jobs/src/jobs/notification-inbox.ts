/**
 * In-app inbox fan-out for platform events — the header bell's data source.
 *
 * When a real platform event fires AND the org has at least one active
 * channel subscribed to it (the same subscription-matrix gate channel
 * delivery uses), one `notification` row is written per org member so the
 * event shows up in every member's in-app inbox. The events carried here
 * (deploys, backups, certs, health) are the same org-visible operational
 * state the dashboard already shows — no role gate.
 *
 * Spam guards:
 *   - `test.ping` / test-mode deliveries never reach the inbox.
 *   - writes are deduped on an occurrence key (the BullMQ job id, stable
 *     across retries) stored in the row's `data`, so a retried job can't
 *     double-write. The write runs BEFORE channel delivery for the same
 *     reason — a channel failure retries the job, and the dedupe absorbs it.
 */
import { db } from "@otterdeploy/db";
import { member, notification } from "@otterdeploy/db/schema";
import { eq, sql } from "drizzle-orm";

export interface InboxFanoutEvent {
  organizationId: string;
  eventId: string;
  title: string;
  message: string;
  data?: Record<string, string>;
}

/**
 * Pure gate: fan out in-app only for real (non-test) occurrences of events
 * the org actually subscribed a channel to. `subscribedChannelCount` is the
 * resolved active-subscribed channel count the event job already computed.
 */
export function shouldFanOutInApp(input: {
  eventId: string;
  testChannelId: string | undefined;
  subscribedChannelCount: number;
}): boolean {
  if (input.testChannelId) return false;
  if (input.eventId === "test.ping") return false;
  return input.subscribedChannelCount > 0;
}

/** Row payloads for one event occurrence — pure, so the mapping is testable. */
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
    data: { ...(event.data ?? {}), eventId: event.eventId, occurrence: occurrenceKey },
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
  return rows.length;
}
