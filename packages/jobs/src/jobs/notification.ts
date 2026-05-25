import * as z from "zod";

import { defineJob } from "../define";

export const NotificationPayload = z.object({
  userId: z.string().min(1),
  type: z.enum(["push", "in-app", "sms"]),
  title: z.string().min(1),
  message: z.string(),
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
    log.info({ notification: { step: "send", userId: payload.userId, type: payload.type } });

    // TODO: real push/in-app/sms send.
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      sent: true,
      type: payload.type,
      userId: payload.userId,
      timestamp: new Date().toISOString(),
    };
  },
});
