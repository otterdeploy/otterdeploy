import { sendEmail } from "@otterdeploy/email";
import * as z from "zod";

import { defineJob } from "../define";

export const EmailPayload = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  templateId: z.string().optional(),
});
export type EmailPayload = z.infer<typeof EmailPayload>;

/** Crude HTML detection so we send the right Resend field. A body with angle
 * brackets is treated as HTML; otherwise it's plain text. */
function looksLikeHtml(body: string): boolean {
  return /<[a-z][\s\S]*>/i.test(body);
}

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

    const isHtml = looksLikeHtml(payload.body);
    // sendEmail throws on Resend errors; BullMQ retries per `opts.attempts`.
    const result = await sendEmail({
      to: payload.to,
      subject: payload.subject,
      html: isHtml ? payload.body : undefined,
      text: isHtml ? undefined : payload.body,
    });

    log.info({ email: { step: "sent", to: payload.to, id: result.data?.id } });

    return {
      sent: true,
      to: payload.to,
      providerId: result.data?.id ?? null,
      timestamp: new Date().toISOString(),
    };
  },
});
