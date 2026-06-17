/**
 * Resolve the outbound email transport from platform settings, with an env
 * fallback. Read at send time (briefly cached) so a config change in the UI
 * takes effect without a restart, and so EVERY sender — better-auth invites,
 * the email job queue, notification channels without their own creds — picks
 * up the configured transport through one path.
 */

import { db } from "@otterdeploy/db";
import {
  PLATFORM_SETTINGS_ID,
  platformSettings,
} from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import { decryptSecret } from "./crypto";

export interface ResendTransport {
  provider: "resend";
  from: string;
  apiKey: string;
}
export interface SmtpTransport {
  provider: "smtp";
  from: string;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}
/** No usable transport — neither the UI nor env supplies a provider. Sends
 *  surface a clear "email isn't configured" error instead of a doomed attempt. */
export interface NoTransport {
  provider: "none";
}
export type ResolvedTransport = ResendTransport | SmtpTransport | NoTransport;

const TTL_MS = 30_000;
let cache: { value: ResolvedTransport; at: number } | null = null;

/** Drop the cached transport so the next send re-reads settings — call after
 *  the settings mutation persists. */
export function invalidateTransport(): void {
  cache = null;
}

/** The env-derived default: Resend with the boot-time key — or "none" when no
 *  RESEND_API_KEY is set (self-hosted installs may configure email later, or
 *  use SMTP via the UI, or not send email at all). */
function envTransport(): ResolvedTransport {
  if (!env.RESEND_API_KEY) return { provider: "none" };
  return {
    provider: "resend",
    from: env.RESEND_FROM_EMAIL,
    apiKey: env.RESEND_API_KEY,
  };
}

async function load(): Promise<ResolvedTransport> {
  const row = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1)
    .then((r) => r[0])
    .catch((cause: unknown) => {
      // Never let a settings read break email — fall back to env.
      log.warn({
        email: { transport: "settings-read-failed" },
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return undefined;
    });

  if (!row || !row.emailProvider) return envTransport();
  const from = row.emailFrom?.trim() || env.RESEND_FROM_EMAIL;

  if (row.emailProvider === "smtp" && row.smtpHost) {
    const pass = row.smtpPasswordCiphertext
      ? await decryptSecret(row.smtpPasswordCiphertext).catch(() => undefined)
      : undefined;
    return {
      provider: "smtp",
      from,
      host: row.smtpHost,
      port: row.smtpPort ?? 587,
      secure: row.smtpSecure ?? false,
      user: row.smtpUser ?? undefined,
      pass,
    };
  }

  if (row.emailProvider === "resend") {
    const apiKey = row.resendApiKeyCiphertext
      ? await decryptSecret(row.resendApiKeyCiphertext).catch(() => env.RESEND_API_KEY)
      : env.RESEND_API_KEY;
    // Provider set to Resend but no key anywhere (UI cleared it, no env key):
    // treat as unconfigured rather than constructing a Resend client that 401s.
    if (!apiKey) return { provider: "none" };
    return { provider: "resend", from, apiKey };
  }

  return envTransport();
}

/** Whether the env supplies a fallback transport (RESEND_API_KEY is set). Lets
 *  the settings UI tell the operator "email falls back to env" vs "unconfigured"
 *  without exposing the key itself. */
export function hasEnvTransport(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export async function resolveTransport(): Promise<ResolvedTransport> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const value = await load();
  cache = { value, at: now };
  return value;
}
