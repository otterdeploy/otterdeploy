import { render } from "@react-email/components";
import { env } from "@otterdeploy/env/server";
import { createError, log } from "evlog";
import nodemailer from "nodemailer";
import { Resend } from "resend";

import { resolveTransport } from "./transport";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  react?: React.ReactElement;
  from?: string;
  replyTo?: string;
  /** Per-call Resend API key. Overrides the platform transport entirely — lets
   * a notification channel bring its own key without touching server config. */
  apiKey?: string;
}

/**
 * Send an email via the platform-configured transport (Resend or SMTP, set in
 * the UI / platform settings, env fallback). A per-call `apiKey` forces Resend
 * with that key (channel BYO-key path) and bypasses the resolver.
 */
export async function sendEmail(options: SendEmailOptions) {
  const { from, apiKey } = options;

  // Channel-provided Resend key: explicit override, no settings lookup.
  if (apiKey) {
    return sendViaResend(apiKey, { ...options, from: from || env.RESEND_FROM_EMAIL });
  }

  const transport = await resolveTransport();

  // No provider configured anywhere — fail with an actionable message instead
  // of a cryptic upstream 502. Callers that treat email as best-effort (invites,
  // notifications) already catch and log; the ones that surface it (test email,
  // password reset) now show the operator exactly what to do.
  if (transport.provider === "none") {
    throw createError({
      message: "Email isn't configured",
      status: 503,
      why: "No email provider is set. Configure Resend or SMTP in Settings → Email, or set RESEND_API_KEY.",
    });
  }

  const fromAddress = from || transport.from;

  if (transport.provider === "smtp") {
    return sendViaSmtp(transport, { ...options, from: fromAddress });
  }
  return sendViaResend(transport.apiKey, { ...options, from: fromAddress });
}

async function sendViaResend(
  apiKey: string,
  options: SendEmailOptions & { from: string },
) {
  const { to, subject, html, text, react, from, replyTo } = options;
  const client = new Resend(apiKey);
  const { data, error } = await client.emails.send({
    from,
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

async function sendViaSmtp(
  transport: Extract<Awaited<ReturnType<typeof resolveTransport>>, { provider: "smtp" }>,
  options: SendEmailOptions & { from: string },
) {
  const { to, subject, html, text, react, from, replyTo } = options;
  // Resend renders `react` itself; nodemailer needs HTML/text, so render here.
  const htmlBody = html ?? (react ? await render(react) : undefined);
  const textBody = text ?? (react ? await render(react, { plainText: true }) : undefined);

  const mailer = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
    secure: transport.secure,
    auth: transport.user ? { user: transport.user, pass: transport.pass } : undefined,
  });

  const info = await mailer.sendMail({
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html: htmlBody,
    text: textBody,
    replyTo,
  });
  return { success: true, data: { id: info.messageId } };
}
