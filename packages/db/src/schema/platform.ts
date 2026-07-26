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

import { bigint, boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { BackupDestinationId } from "@otterdeploy/shared/id";

import { backupDestination } from "./backup";

export const PLATFORM_SETTINGS_ID = "platform";

export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey().default(PLATFORM_SETTINGS_ID),
  /** Irreversible first-account bootstrap marker. This is intentionally
   * independent from the current user count: deleting the owner row must never
   * make the installer token valid again. */
  bootstrapCompletedAt: timestamp("bootstrap_completed_at"),
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

  // ═══ Runtime configuration (od-gfg) ══════════════════════════════════
  // Everything below follows the same contract as the email transport
  // above: the env var SEEDS the value (and stays the fallback while the
  // column is null), but once an operator edits it in the UI this row is
  // the source of truth. A null column therefore means "defer to env",
  // never "off" — see packages/api/src/lib/platform-runtime-settings.ts,
  // which is the only place allowed to resolve the two against each other.

  // ─── Who may create an account ──────────────────────────────────────
  /** "invite-only" (default) ⇒ registration requires a pending invitation.
   *  "open" ⇒ anyone who can reach the sign-in page may self-register.
   *  null ⇒ invite-only. NOTE: this governs only accounts created AFTER
   *  bootstrap; the FIRST account always requires the installer's
   *  bootstrap token regardless of this value, and open registration never
   *  grants install-admin. See packages/auth/src/registration-policy.ts. */
  registrationMode: text("registration_mode"),

  // ─── Social sign-in (SSO) ───────────────────────────────────────────
  // Seeded from {GITHUB,GOOGLE,GITLAB}_OAUTH_CLIENT_ID/_SECRET. A provider
  // is live only when enabled AND it has both a client id and a secret.
  // Editing these hot-reloads the better-auth instance (packages/auth
  // reloadAuth) — no restart, and no SPA rebuild either, because the web
  // reads the enabled list from /api/auth/public-config at runtime rather
  // than the build-time VITE_AUTH_SOCIAL_PROVIDERS it used to.
  githubOauthEnabled: boolean("github_oauth_enabled"),
  githubOauthClientId: text("github_oauth_client_id"),
  githubOauthClientSecretCiphertext: text("github_oauth_client_secret_ciphertext"),
  googleOauthEnabled: boolean("google_oauth_enabled"),
  googleOauthClientId: text("google_oauth_client_id"),
  googleOauthClientSecretCiphertext: text("google_oauth_client_secret_ciphertext"),
  gitlabOauthEnabled: boolean("gitlab_oauth_enabled"),
  gitlabOauthClientId: text("gitlab_oauth_client_id"),
  gitlabOauthClientSecretCiphertext: text("gitlab_oauth_client_secret_ciphertext"),
  /** Self-hosted GitLab base URL; null ⇒ gitlab.com. */
  gitlabOauthIssuer: text("gitlab_oauth_issuer"),

  // ─── External notification transports (SMS + push) ──────────────────
  // Seeded from TWILIO_* / FCM_SERVER_KEY. Consumed by packages/jobs
  // delivery for both the per-user sms/push fan-out and the `push`
  // notification channel kind.
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthTokenCiphertext: text("twilio_auth_token_ciphertext"),
  twilioFromNumber: text("twilio_from_number"),
  fcmServerKeyCiphertext: text("fcm_server_key_ciphertext"),

  // ─── Firewall / CrowdSec bouncer ────────────────────────────────────
  // Seeded from CROWDSEC_LAPI_URL / CROWDSEC_BOUNCER_KEY. Saving these
  // re-renders the Caddyfile global block + per-site gate. The agent
  // container itself still has to be running (compose `firewall` profile)
  // — the UI says so rather than pretending it can start it.
  crowdsecLapiUrl: text("crowdsec_lapi_url"),
  crowdsecBouncerKeyCiphertext: text("crowdsec_bouncer_key_ciphertext"),
  /** Explicit off-switch that survives credentials being present, so an
   *  operator can disable the edge gate without clearing the key. */
  crowdsecEnabled: boolean("crowdsec_enabled"),

  // ─── Outbound egress allowlist ──────────────────────────────────────
  /** Comma-separated bare IPs/CIDRs, same grammar as
   *  OTTERDEPLOY_EGRESS_ALLOWLIST. null ⇒ use env. Empty string ⇒ an
   *  explicit "allow nothing" that overrides a non-empty env value. */
  egressAllowlist: text("egress_allowlist"),

  // ─── PR previews ────────────────────────────────────────────────────
  /** Hours of inactivity before an open preview is torn down; 0 disables
   *  idle teardown. null ⇒ PREVIEW_IDLE_TEARDOWN_HOURS. */
  previewIdleTeardownHours: integer("preview_idle_teardown_hours"),

  // ─── Edge logs ──────────────────────────────────────────────────────
  /** Persist access logs to edge_log behind the live ring. null ⇒
   *  EDGE_LOG_PERSIST. Takes effect on the next server start. */
  edgeLogPersist: boolean("edge_log_persist"),
  /** Days of edge_log partitions to keep. null ⇒ 7 (the previous
   *  hardcoded constant in edge-logs/persist.ts). */
  edgeLogRetentionDays: integer("edge_log_retention_days"),
  /** Mirror/override for the managed GeoIP downloads (air-gapped installs).
   *  null ⇒ EDGE_LOG_GEOIP_URL / EDGE_LOG_GEOIP_ASN_URL. */
  edgeLogGeoipUrl: text("edge_log_geoip_url"),
  edgeLogGeoipAsnUrl: text("edge_log_geoip_asn_url"),

  // ─── Build pipeline ─────────────────────────────────────────────────
  /** Deploy jobs the builder pulls concurrently. null ⇒
   *  BUILDER_CONCURRENCY. Read at worker start, so a change needs the
   *  builder to restart — the UI states that plainly. */
  builderConcurrency: integer("builder_concurrency"),

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

  // ═══ Whole-control-plane backup + disaster recovery (od-5j8.13) ═════
  // Distinct from the tenant-facing `backup`/`backup_schedule`/
  // `backup_destination` tables (packages/db/src/schema/backup.ts), which
  // back up ORG resources (databases/volumes). This section tracks the
  // control plane's OWN backup: its Postgres, data dir, and Caddy state.
  // Execution is a host-level script (scripts/control-plane-backup.sh) —
  // not a BullMQ job — because it needs to dump the control plane's own
  // database and tar named Docker volumes from OUTSIDE any container this
  // process runs in. This row is the status/config surface the script
  // reports into and the readiness API reads from; see
  // packages/api/src/backups/control-plane-readiness.ts and
  // docs/designs/control-plane-disaster-recovery.md.
  /** Operator intent — whether control-plane backups are expected to run at
   *  all. Distinct from "configured": an operator can wire a destination and
   *  a recovery key and still leave this off during initial setup. */
  controlPlaneBackupEnabled: boolean("control_plane_backup_enabled").notNull().default(false),
  /** Reuses an existing (org-scoped) `backup_destination` row as the
   *  off-host target for control-plane archives — deliberately NOT a
   *  separate destination-config surface, so S3 creds/testing/rotation stay
   *  in the one place that already implements them. `onDelete: set null` so
   *  deleting the destination degrades readiness to `not_ready` (missing
   *  destination) rather than leaving a dangling FK. */
  controlPlaneBackupDestinationId: text("control_plane_backup_destination_id")
    .$type<BackupDestinationId>()
    .references(() => backupDestination.id, { onDelete: "set null" }),
  /** sha256(recoveryKey)[:8] — see packages/api/src/lib/recovery-key.ts. The
   *  platform NEVER stores the recovery key itself, only this fingerprint,
   *  so a compromised control-plane DB can't leak the key that protects its
   *  own backups. Used only so the readiness UI can show "a key exists" and
   *  let the operator visually confirm a held key matches. */
  controlPlaneRecoveryKeyFingerprint: text("control_plane_recovery_key_fingerprint"),
  controlPlaneRecoveryKeyGeneratedAt: timestamp("control_plane_recovery_key_generated_at"),
  /** Operator-confirmed "I have saved this key off-host" — set by a separate
   *  explicit confirmation call, never implied by generation alone. An
   *  unconfirmed key is treated as not exported for readiness purposes. */
  controlPlaneRecoveryKeyExportedAt: timestamp("control_plane_recovery_key_exported_at"),
  /** Timestamp of the most recent run that reached `succeeded`. Reported by
   *  `scripts/control-plane-backup.sh` calling back into the running API
   *  (`backups.controlPlane.reportRun`, install-admin only) after the
   *  archive is uploaded — so this table stays the single place that knows
   *  the schema, rather than duplicating column names into a shell script. */
  controlPlaneLastBackupAt: timestamp("control_plane_last_backup_at"),
  /** Status + timestamp of the single most recent attempt, which may be a
   *  failure even when `controlPlaneLastBackupAt` (last SUCCESS) is set. */
  controlPlaneLastRunStatus: text("control_plane_last_run_status"),
  controlPlaneLastRunAt: timestamp("control_plane_last_run_at"),
  controlPlaneLastRunError: text("control_plane_last_run_error"),
  /** Size of the encrypted archive produced by the last successful run. */
  controlPlaneLastBackupSizeBytes: bigint("control_plane_last_backup_size_bytes", {
    mode: "number",
  }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
