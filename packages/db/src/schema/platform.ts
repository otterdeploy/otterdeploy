/**
 * Platform-wide settings — single-row table keyed by a fixed id. Same
 * pattern Coolify uses for `InstanceSettings`: there's exactly one row
 * per install, and it carries the configuration that lives above any
 * org/user (control plane URL, ACME issuer email, the host IP we use
 * for sslip.io fallback domains, etc.).
 *
 * Bootstrap: a default row is upserted on app boot with the id below
 * and values seeded from env vars. The settings page mutates this row
 * in place — no row-per-version or history kept; if change tracking is
 * needed later, write to a separate audit log.
 */

import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const PLATFORM_SETTINGS_ID = "platform";

export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey().default(PLATFORM_SETTINGS_ID),
  /** Hostname the otterdeploy UI itself answers on. Seeded from
   *  OTTERDEPLOY_CONTROL_PLANE_HOST. Caddy uses this to issue the cert for
   *  the control plane; better-auth uses it for trusted-origins. */
  controlPlaneFqdn: text("control_plane_fqdn"),
  /** Public IP the swarm manager exposes — used to build sslip.io
   *  fallback domains (`<ip>.sslip.io`) so a fresh install resolves
   *  without the operator owning any domain. Detected on first boot
   *  and editable from the platform settings page. */
  serverIp: text("server_ip"),
  /** Email address Caddy registers with Let's Encrypt for ACME
   *  notifications + recovery. Required before any real (non-sslip)
   *  domain can be issued a public cert. */
  acmeEmail: text("acme_email"),

  // ─── Outbound email transport (system emails: verification, invites,
  //     guest OTP). Configured in the UI; falls back to env (RESEND_API_KEY /
  //     RESEND_FROM_EMAIL) when unset. Secrets are encrypted at rest with the
  //     same pipeline as registry/backup secrets. See packages/email/transport.
  /** "resend" | "smtp" | null (null ⇒ use env defaults). */
  emailProvider: text("email_provider"),
  /** From address override (e.g. "otterdeploy <no-reply@acme.com>"). */
  emailFrom: text("email_from"),
  /** Resend API key, encrypted (encryptSecret blob). */
  resendApiKeyCiphertext: text("resend_api_key_ciphertext"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  /** TLS-on-connect (465). false ⇒ STARTTLS (587). */
  smtpSecure: boolean("smtp_secure"),
  smtpUser: text("smtp_user"),
  /** SMTP password, encrypted (encryptSecret blob). */
  smtpPasswordCiphertext: text("smtp_password_ciphertext"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
