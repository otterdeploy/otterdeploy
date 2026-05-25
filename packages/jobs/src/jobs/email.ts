import * as z from "zod";

import { defineJob } from "../define";

export const EmailPayload = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  templateId: z.string().optional(),
});
export type EmailPayload = z.infer<typeof EmailPayload>;

export const sendEmailJob = defineJob({
  name: "email.send",
  schema: EmailPayload,
  opts: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 60 * 60 * 24 }, // keep 24h of completed jobs for the dashboard
    removeOnFail: { age: 60 * 60 * 24 * 7 }, // keep 7d of failures
  },
  async handler(payload, { log }) {
    log.info({ email: { step: "send", to: payload.to } });

    // TODO: real Resend call. Mocked for now.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      sent: true,
      to: payload.to,
      timestamp: new Date().toISOString(),
    };
  },
});
