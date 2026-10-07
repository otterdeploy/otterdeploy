import type { EmailProvider, EmailRetryConfig } from "@opencoredev/email-sdk";

import { createEmailClient, isRetryableEmailError } from "@opencoredev/email-sdk";
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
  /** Plain-text alternative. The HTML part is ALWAYS rendered from `react`. We
   *  never accept raw HTML strings; every email is a React Email component. */
  text?: string;
  react?: React.ReactElement;
  from?: string;
  replyTo?: string;
  /** Per-call Resend API key. Overrides the platform transport entirely. Lets
   * a notification channel bring its own key without touching server config. */
  apiKey?: string;
  /** Same key for every attempt of one logical email (Resend's
   *  `Idempotency-Key`), so a retry after a lost response cannot send twice.
   *  Resend keeps a key for 24 hours. */
  idempotencyKey?: string;
}

/**
 * Transient send failures (Resend 429 / 5xx, a reset connection) are retried,
 * bounded: {@link EMAIL_SEND_RETRIES} retries, each waiting what Resend's
 * `Retry-After` asked for (at least {@link EMAIL_RETRY_BASE_DELAY_MS}, doubled
 * per attempt), and none at all when the provider asks for longer than
 * {@link EMAIL_RETRY_MAX_WAIT_MS}: a request should not stall on it. The SDK
 * defaults to zero retries, so one rate-limited moment used to lose the email.
 */
export const EMAIL_SEND_RETRIES = 2;
export const EMAIL_RETRY_BASE_DELAY_MS = 500;
export const EMAIL_RETRY_MAX_WAIT_MS = 10_000;

/** A fetch that remembers the last `Retry-After` it saw, for the retry delay. */
function createRetryAfterTracker() {
  let retryAfterMs: number | null = null;
  const tracked: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const response = await fetch(input, init);
      const header = response.headers.get("retry-after")?.trim();
      retryAfterMs =
        header && /^\d+(\.\d+)?$/.test(header) ? Math.ceil(Number(header) * 1000) : null;
      return response;
    },
    { preconnect: fetch.preconnect },
  );
  const retry: EmailRetryConfig = {
    retries: EMAIL_SEND_RETRIES,
    shouldRetry: (error) =>
      isRetryableEmailError(error) && (retryAfterMs ?? 0) <= EMAIL_RETRY_MAX_WAIT_MS,
    delay: (attempt) => Math.max(retryAfterMs ?? 0, EMAIL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
  };
  return { fetch: tracked, retry };
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

  const tracker = createRetryAfterTracker();

  // Channel-provided Resend key: explicit override, no settings lookup.
  if (apiKey) {
    return deliver(
      resend({ apiKey, fetch: tracker.fetch }),
      { ...options, from: from || env.RESEND_FROM_EMAIL },
      tracker.retry,
    );
  }

  const transport = await resolveTransport();

  // No provider configured anywhere: fail with an actionable message instead
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
      : resend({ apiKey: transport.apiKey, fetch: tracker.fetch });

  return deliver(provider, { ...options, from: fromAddress }, tracker.retry);
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
async function deliver(
  provider: EmailProvider,
  options: SendEmailOptions & { from: string },
  retry?: EmailRetryConfig,
) {
  const { to, subject, text, react, from, replyTo, idempotencyKey } = options;
  // The SDK transports HTML/text; React Email is our authoring layer, so render
  // here. We never carry a raw HTML string.
  const html = react ? await render(react) : undefined;
  const textBody = text ?? (react ? await render(react, { plainText: true }) : undefined);

  const client = createEmailClient({ adapters: [provider], retry });

  const sent = await Result.tryPromise({
    try: () =>
      client.send(
        {
          from,
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
          text: textBody,
          replyTo,
        },
        { idempotencyKey },
      ),
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
