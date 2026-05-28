import * as z from "zod";

import { defineJob } from "../define";

export const UserSignupPayload = z.object({
  userId: z.string().min(1),
  email: z.email(),
  name: z.string(),
});
export type UserSignupPayload = z.infer<typeof UserSignupPayload>;

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Welcome sequence: send welcome email immediately, tips email after 1 day,
 * features email 3 days after that.
 *
 * The Inngest version used `step.sleep()`. In BullMQ we get the same
 * deferred-execution behavior by enqueueing each follow-up email with a
 * `delay` — the job sits in the delayed set until its time comes and BullMQ
 * promotes it automatically.
 */
export const welcomeSequenceJob = defineJob({
  name: "user.welcome-sequence",
  schema: UserSignupPayload,
  opts: {
    attempts: 3,
    removeOnComplete: { age: 60 * 60 * 24 * 7 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
  async handler(payload, { log }) {
    const { userId, email, name } = payload;
    log.info({ welcome: { step: "start", userId } });

    const { triggerEmail } = await import("../triggers");

    // Immediate welcome
    await triggerEmail({
      to: email,
      subject: "Welcome to otterdeploy!",
      body: `Hi ${name}, welcome aboard!`,
    });

    // Tips email — 1 day later
    await triggerEmail(
      {
        to: email,
        subject: "Getting Started Tips",
        body: `Hi ${name}, here are some tips to get the most out of otterdeploy...`,
      },
      { delay: ONE_DAY_MS },
    );

    // Feature highlight — 4 days after signup (1 + 3)
    await triggerEmail(
      {
        to: email,
        subject: "Discover More Features",
        body: `Hi ${name}, have you tried these features yet?`,
      },
      { delay: ONE_DAY_MS * 4 },
    );

    return {
      completed: true,
      userId,
      timestamp: new Date().toISOString(),
    };
  },
});
