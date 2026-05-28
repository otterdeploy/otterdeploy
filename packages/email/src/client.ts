import { env } from "@otterdeploy/env/server";
import { createError, log } from "evlog";
import { Resend } from "resend";

// Initialize Resend client
const resend = new Resend(env.RESEND_API_KEY);

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  react?: React.ReactElement;
  from?: string;
  replyTo?: string;
}

/**
 * Send an email using Resend
 * @see https://resend.com/docs/send-with-nodejs
 */
export async function sendEmail(options: SendEmailOptions) {
  const { to, subject, html, text, react, from, replyTo } = options;

  const fromAddress = from || env.RESEND_FROM_EMAIL;

  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
    react,
    replyTo,
  });

  if (error) {
    log.error(error);
    throw createError({
      message: "Failed to send email",
      status: 502,
      why: error.message,
      cause: error,
    });
  }

  return { success: true, data };
}

/**
 * Get the Resend client instance for advanced usage
 */
export function getResendClient() {
  return resend;
}

export { resend };
