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
  /** Hostname the otterdeploy UI itself answers on. Set from the workspace
   *  settings page ("Control plane" card). When present, reconcile emits a
   *  Caddy site block proxying it to the control plane; better-auth already
   *  trusts same-origin requests, so no auth config change is needed. */
  controlPlaneFqdn: text("control_plane_fqdn"),
  /** TXT-verification state for controlPlaneFqdn — same model as the org
   *  base domain: the site block goes live immediately (tls internal), but
   *  ACME issuance is gated on proving ownership. */
  controlPlaneFqdnVerifiedAt: timestamp("control_plane_fqdn_verified_at"),
  controlPlaneFqdnVerifyToken: text("control_plane_fqdn_verify_token"),
  /** Public IP the swarm manager exposes — used to build sslip.io
   *  fallback domains (`<ip>.sslip.io`) so a fresh install resolves
   *  without the operator owning any domain. Detected on first boot
   *  and editable from the platform settings page. */
  serverIp: text("server_ip"),
  /** Email address Caddy registers with Let's Encrypt for ACME
   *  notifications + recovery. Required before any real (non-sslip)
   *  domain can be issued a public cert. */
  acmeEmail: text("acme_email"),
  /** Whether Caddy auto-redirects HTTP→HTTPS. null/true ⇒ on (Caddy's
   *  default); false ⇒ render `auto_https disable_redirects` in the global
   *  block (e.g. a downstream load balancer already terminates/redirects TLS). */
  httpsAutoRedirect: boolean("https_auto_redirect"),

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

  // ─── Platform self-update (packages/api/src/routers/system). The CURRENT
  //     version is not stored here — it's read live from env.OTTERDEPLOY_VERSION
  //     (the image tag the compose stack booted with). These columns cache the
  //     last "check for updates" result + hold the operator's update prefs, the
  //     same split Coolify keeps on InstanceSettings. Transient apply run-state
  //     (progress/logs) lives in-memory + a status file under DATA_DIR, not here.
  /** Release channel to track. "stable" ⇒ GitHub `releases/latest`. */
  updateChannel: text("update_channel").default("stable"),
  /** When on, the scheduled updater applies a newer version automatically. */
  autoUpdateEnabled: boolean("auto_update_enabled").default(false),
  /** Last time `checkForUpdate` successfully reached the release source. */
  lastUpdateCheckedAt: timestamp("last_update_checked_at"),
  /** Cached newest version tag from the last check (e.g. "v0.5.0"), or null
   *  when up to date / never checked. */
  availableVersion: text("available_version"),
  /** Cached release notes (markdown) + URL for the available version. */
  availableReleaseNotes: text("available_release_notes"),
  availableReleaseUrl: text("available_release_url"),
  /** Version the operator dismissed the "update available" banner for, so a
   *  known update stops nagging until a newer one appears. */
  dismissedVersion: text("dismissed_version"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
