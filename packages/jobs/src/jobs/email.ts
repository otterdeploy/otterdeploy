import { MessageEmail, sendEmail } from "@otterdeploy/email";
import * as z from "zod";

import { defineJob } from "../define";

export const EmailPayload = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  /** Plain-text message body. Rendered through the MessageEmail React template —
   *  never sent as raw HTML. Blank lines become paragraph breaks. */
  body: z.string(),
  /** Optional heading shown above the body; defaults to the subject. */
  heading: z.string().optional(),
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

    // Every email renders through a React Email template — the plain-text body
    // becomes the `text` alternative; the HTML part comes from MessageEmail.
    // sendEmail throws on Resend errors; BullMQ retries per `opts.attempts`.
    const result = await sendEmail({
      to: payload.to,
      subject: payload.subject,
      react: MessageEmail({ heading: payload.heading ?? payload.subject, body: payload.body }),
      text: payload.body,
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
