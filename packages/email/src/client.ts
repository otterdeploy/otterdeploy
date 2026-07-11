import type { EmailProvider } from "@opencoredev/email-sdk";

import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { env } from "@otterdeploy/env/server";
import { render } from "@react-email/components";
import { Result } from "better-result";
import { createError, log } from "evlog";

import { resolveTransport } from "./transport";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  /** Plain-text alternative. The HTML part is ALWAYS rendered from `react` — we
   *  never accept raw HTML strings; every email is a React Email component. */
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
 * the UI / platform settings, env fallback). Delivery goes through the
 * @opencoredev/email-sdk client; content is always a React Email component that
 * we render to HTML/text here. A per-call `apiKey` forces Resend with that key
 * (channel BYO-key path) and bypasses the resolver.
 */
export async function sendEmail(options: SendEmailOptions) {
  const { from, apiKey } = options;

  // Channel-provided Resend key: explicit override, no settings lookup.
  if (apiKey) {
    return deliver(resend({ apiKey }), { ...options, from: from || env.RESEND_FROM_EMAIL });
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
  const provider =
    transport.provider === "smtp"
      ? smtp({
          host: transport.host,
          port: transport.port,
          secure: transport.secure,
          auth: transport.user ? { user: transport.user, pass: transport.pass ?? "" } : undefined,
        })
      : resend({ apiKey: transport.apiKey });

  return deliver(provider, { ...options, from: fromAddress });
}

export interface SmtpServerConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}

/**
 * Send through a caller-supplied SMTP server (e.g. a notification channel's own
 * mail server) rather than the platform transport. Same SDK + React Email path,
 * so channels never hand-roll a nodemailer transport or raw HTML.
 */
export async function sendViaSmtpServer(
  config: SmtpServerConfig,
  options: SendEmailOptions & { from: string },
) {
  const provider = smtp({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
  });
  return deliver(provider, options);
}

/** Render the React Email component and hand the HTML/text to the SDK adapter. */
async function deliver(provider: EmailProvider, options: SendEmailOptions & { from: string }) {
  const { to, subject, text, react, from, replyTo } = options;
  // The SDK transports HTML/text; React Email is our authoring layer, so render
  // here. We never carry a raw HTML string.
  const html = react ? await render(react) : undefined;
  const textBody = text ?? (react ? await render(react, { plainText: true }) : undefined);

  const client = createEmailClient({ adapters: [provider] });

  const sent = await Result.tryPromise({
    try: () =>
      client.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text: textBody,
        replyTo,
      }),
    catch: (cause) => cause,
  });

  if (sent.isErr()) {
    const message = sent.error instanceof Error ? sent.error.message : String(sent.error);
    log.error({ email: { step: "send-failed" }, error: message });
    throw createError({
      message: "Failed to send email",
      status: 502,
      why: message,
      cause: sent.error instanceof Error ? sent.error : undefined,
    });
  }

  return { success: true, data: { id: sent.value.messageId ?? sent.value.id ?? null } };
}
