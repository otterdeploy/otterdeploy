import { db } from "@otterdeploy/db";
import { notification } from "@otterdeploy/db/schema/notification";
import * as z from "zod";

import { defineJob } from "../define";
import { deliverExternal } from "../delivery/notify";

export const NotificationPayload = z.object({
  userId: z.string().min(1),
  type: z.enum(["push", "in-app", "sms"]),
  title: z.string().min(1),
  message: z.string(),
  organizationId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type NotificationPayload = z.infer<typeof NotificationPayload>;

export const sendNotificationJob = defineJob({
  name: "notification.send",
  schema: NotificationPayload,
  opts: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log }) {
    log.info({
      notification: { step: "send", userId: payload.userId, type: payload.type },
    });

    // Every notification — regardless of channel — leaves an in-app row so it
    // shows up in the user's activity feed. This is the durable record.
    const [row] = await db
      .insert(notification)
      .values({
        userId: payload.userId,
        organizationId: payload.organizationId ?? null,
        channel: payload.type,
        title: payload.title,
        message: payload.message,
        data: payload.data ?? null,
      })
      .returning({ id: notification.id });

    // push/sms additionally fan out to an external provider. When no provider
    // is configured this is a logged no-op (the in-app row still persisted).
    let externalDelivered = false;
    if (payload.type === "push" || payload.type === "sms") {
      externalDelivered = await deliverExternal({
        channel: payload.type,
        userId: payload.userId,
        title: payload.title,
        message: payload.message,
        data: payload.data,
        log,
      });
    }

    return {
      sent: true,
      notificationId: row?.id ?? null,
      type: payload.type,
      userId: payload.userId,
      externalDelivered,
      timestamp: new Date().toISOString(),
    };
  },
});
