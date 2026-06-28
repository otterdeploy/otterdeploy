/**
 * Outbound email transport settings (platform-wide singleton). Split out of the
 * org-settings handlers. Surfaced under org settings for the single-tenant beta;
 * writes the one install-wide platform_settings row. Secrets are encrypted at
 * rest and never returned — reads expose only `*Configured` booleans.
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { hasEnvTransport, invalidateTransport, sendEmail } from "@otterdeploy/email";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { encryptSecret } from "../../lib/crypto";

export interface EmailSettingsView {
  provider: "resend" | "smtp" | null;
  from: string | null;
  resendConfigured: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPasswordConfigured: boolean;
  /** RESEND_API_KEY is set in env, so "Platform default" actually sends. When
   *  false and no provider is configured, email is unconfigured (UI warns). */
  envConfigured: boolean;
}

type PlatformRow = typeof platformSettings.$inferSelect;

function toEmailView(row: PlatformRow | undefined): EmailSettingsView {
  return {
    provider: (row?.emailProvider as "resend" | "smtp" | null) ?? null,
    from: row?.emailFrom ?? null,
    resendConfigured: Boolean(row?.resendApiKeyCiphertext),
    smtpHost: row?.smtpHost ?? null,
    smtpPort: row?.smtpPort ?? null,
    smtpSecure: row?.smtpSecure ?? null,
    smtpUser: row?.smtpUser ?? null,
    smtpPasswordConfigured: Boolean(row?.smtpPasswordCiphertext),
    envConfigured: hasEnvTransport(),
  };
}

export async function getEmailSettings(): Promise<EmailSettingsView> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return toEmailView(row);
}

export interface SaveEmailSettingsInput {
  provider: "resend" | "smtp" | null;
  from: string | null;
  /** undefined ⇒ leave unchanged; null ⇒ clear; string ⇒ set (encrypted). */
  resendApiKey?: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPassword?: string | null;
}

export async function saveEmailSettings(input: SaveEmailSettingsInput): Promise<EmailSettingsView> {
  const set: Partial<typeof platformSettings.$inferInsert> = {
    emailProvider: input.provider,
    emailFrom: input.from,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUser: input.smtpUser,
  };
  if (input.resendApiKey !== undefined) {
    set.resendApiKeyCiphertext = input.resendApiKey
      ? await encryptSecret(input.resendApiKey)
      : null;
  }
  if (input.smtpPassword !== undefined) {
    set.smtpPasswordCiphertext = input.smtpPassword
      ? await encryptSecret(input.smtpPassword)
      : null;
  }

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });

  // Drop the email package's cached transport so the next send re-reads.
  invalidateTransport();
  return getEmailSettings();
}

export async function sendTestEmail(to: string): Promise<{ ok: boolean; error: string | null }> {
  const res = await Result.tryPromise({
    // Return void — we only care that it didn't throw, and returning
    // sendEmail's cross-package union return trips no-unsafe-return.
    try: async () => {
      await sendEmail({
        to,
        subject: "otterdeploy — test email",
        html: "<p>This is a test email from otterdeploy. Your email transport is working.</p>",
        text: "This is a test email from otterdeploy. Your email transport is working.",
      });
    },
    catch: (cause) => cause,
  });
  return res.isOk()
    ? { ok: true, error: null }
    : {
        ok: false,
        error: res.error instanceof Error ? res.error.message : String(res.error),
      };
}
