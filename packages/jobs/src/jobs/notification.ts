import { db } from "@otterdeploy/db";
import { notification } from "@otterdeploy/db/schema/notification";
import { Temporal } from "@otterdeploy/shared/temporal";
import { UnrecoverableError } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";

import { defineJob, type JobLogger } from "../define";
import { deliverExternal } from "../delivery/notify";

export const NotificationPayload = z.object({
  userId: z.string().min(1),
  type: z.enum(["push", "in-app", "sms"]),
  title: z.string().min(1),
  message: z.string(),
  organizationId: z.string().optional(),
  // `z.json()` values (not `z.unknown()`) so the inferred type stays
  // JSON-shaped and flows into the `notification.data` jsonb column.
  data: z.record(z.string(), z.json()).optional(),
});
export type NotificationPayload = z.infer<typeof NotificationPayload>;

/**
 * One notification: the in-app row, then the push/sms fan-out. The job
 * handler below is this with the BullMQ job id as the `occurrence`; split out
 * so the retry behaviour can be driven without a queue.
 */
export async function deliverNotification(
  payload: NotificationPayload,
  { log, occurrence }: { log: JobLogger; occurrence: string | null },
) {
  log.info({
    notification: { step: "send", userId: payload.userId, type: payload.type },
  });

  // Every notification (regardless of channel) leaves an in-app row so it
  // shows up in the user's activity feed. This is the durable record.
  //
  // Written once per job, not once per attempt: a failed push/sms throws so
  // BullMQ retries the job, and every retry used to insert another copy
  // (three attempts, three identical rows). The BullMQ job id is stable
  // across retries, so it keys the row, as the platform-event inbox does
  // (notification-inbox.ts).
  const [existing] = occurrence
    ? await db
        .select({ id: notification.id })
        .from(notification)
        .where(
          and(
            eq(notification.userId, payload.userId),
            sql`${notification.data} ->> 'occurrence' = ${occurrence}`,
          ),
        )
        .limit(1)
    : [];
  const [row] = existing
    ? [existing]
    : await db
        .insert(notification)
        .values({
          userId: payload.userId,
          organizationId: payload.organizationId ?? null,
          channel: payload.type,
          title: payload.title,
          message: payload.message,
          data: occurrence ? { ...payload.data, occurrence } : (payload.data ?? null),
        })
        .returning({ id: notification.id });

  // push/sms additionally fan out to an external provider. When no provider
  // is configured this is a logged no-op (the in-app row still persisted).
  let externalDelivered = false;
  if (payload.type === "push" || payload.type === "sms") {
    const external = await deliverExternal({
      channel: payload.type,
      userId: payload.userId,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      log,
    });
    // A failure a later attempt may get past (rate limit, outage) fails the
    // attempt so BullMQ retries it; one that would repeat (dead device
    // token, bad credentials, invalid number) ends the job now.
    if (external.status === "failed") {
      throw external.retryable ? new Error(external.error) : new UnrecoverableError(external.error);
    }
    externalDelivered = external.status === "delivered";
  }

  return {
    sent: true,
    notificationId: row?.id ?? null,
    type: payload.type,
    userId: payload.userId,
    externalDelivered,
    timestamp: Temporal.Now.instant().toString(),
  };
}

export const sendNotificationJob = defineJob({
  name: "notification.send",
  schema: NotificationPayload,
  opts: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  handler: (payload, { log, job }) =>
    deliverNotification(payload, { log, occurrence: job.id ? `job:${job.id}` : null }),
});
