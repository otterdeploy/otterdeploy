/**
 * Runtime configuration resolver — the single place that reconciles the
 * `platform_settings` singleton against the env vars that seed it.
 *
 * The contract every setting here obeys:
 *
 *   env var  →  seeds the value and remains the fallback while the column
 *               is NULL. Never re-applied over a value the operator typed.
 *   column   →  source of truth the moment it is non-NULL. NULL means
 *               "defer to env", which is why an explicit "off" needs a real
 *               value (empty string / false / 0) rather than a NULL.
 *
 * That asymmetry is deliberate and matches how the email transport already
 * behaves: a fresh install works with zero UI configuration, and an operator
 * who edits a setting in the app doesn't have their edit stomped on the next
 * boot by a stale `.env` (the trap `SERVER_IP` still has — it re-applies every
 * boot, which is why its card renders read-only when the env is set).
 *
 * Reads are cached in-process for CACHE_TTL_MS because several of these sit on
 * hot paths (every egress call, every preview upsert). `invalidatePlatformRuntimeSettings()`
 * is called by every writer, so the TTL only bounds staleness across processes
 * (server / builder / job workers each hold their own copy) — a setting changed
 * in the UI is live immediately in the API process and within the TTL everywhere
 * else. Settings that genuinely cannot hot-reload (builder concurrency, edge-log
 * persistence) say so in their card rather than pretending otherwise.
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { decryptSecret } from "./crypto";

type PlatformRow = typeof platformSettings.$inferSelect;

const CACHE_TTL_MS = 10_000;

let cached: { row: PlatformRow | undefined; at: number } | null = null;
let inflight: Promise<PlatformRow | undefined> | null = null;

/** Drop the memoized row so the next read re-queries. Every writer must call
 *  this; forgetting to is the one way a saved setting appears not to apply. */
export function invalidatePlatformRuntimeSettings(): void {
  cached = null;
  inflight = null;
}

async function loadRow(): Promise<PlatformRow | undefined> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.row;
  // Collapse concurrent misses onto one query — on a cold cache the egress
  // path can otherwise fire several identical selects for one request.
  inflight ??= (async () => {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1);
    cached = { row, at: Date.now() };
    inflight = null;
    return row;
  })();
  return inflight;
}

/** Decrypt a stored secret, treating a corrupt/undecryptable blob as absent.
 *  A key-rotation mistake must degrade a provider to "not configured" (which
 *  the UI shows) rather than throw on a hot path like an outbound fetch. */
async function decryptOrNull(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  const result = await Result.tryPromise({
    try: () => decryptSecret(blob),
    catch: (cause) => cause,
  });
  return result.unwrapOr(null);
}

// ─── Registration policy ──────────────────────────────────────────────

export type RegistrationPolicy = "invite-only" | "open";

/** How accounts may be created AFTER bootstrap. Never affects the first
 *  account (always bootstrap-token gated) or install-admin status. */
export async function registrationPolicy(): Promise<RegistrationPolicy> {
  const row = await loadRow();
  return row?.registrationMode === "open" ? "open" : "invite-only";
}

// ─── Social sign-in ───────────────────────────────────────────────────

export const SOCIAL_PROVIDER_IDS = ["github", "google", "gitlab"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export interface ResolvedSocialProvider {
  id: SocialProviderId;
  clientId: string;
  clientSecret: string;
  /** GitLab only — self-hosted instance base URL. */
  issuer?: string;
}

/** Column names per provider. Table-driven rather than a switch so the read
 *  path and the settings writer can't drift onto different columns. */
const PROVIDER_COLUMNS = {
  github: {
    enabled: "githubOauthEnabled",
    clientId: "githubOauthClientId",
    secret: "githubOauthClientSecretCiphertext",
  },
  google: {
    enabled: "googleOauthEnabled",
    clientId: "googleOauthClientId",
    secret: "googleOauthClientSecretCiphertext",
  },
  gitlab: {
    enabled: "gitlabOauthEnabled",
    clientId: "gitlabOauthClientId",
    secret: "gitlabOauthClientSecretCiphertext",
  },
} as const satisfies Record<
  SocialProviderId,
  { enabled: string; clientId: string; secret: string }
>;

/** Per-provider env seed, so "what does env give us" is answerable in one
 *  place (the settings UI shows it as the fallback). */
const PROVIDER_ENV: Record<SocialProviderId, { clientId?: string; clientSecret?: string }> = {
  github: { clientId: env.GITHUB_OAUTH_CLIENT_ID, clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET },
  google: { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET },
  gitlab: { clientId: env.GITLAB_OAUTH_CLIENT_ID, clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET },
};

function dbProvider(row: PlatformRow | undefined, id: SocialProviderId) {
  const col = PROVIDER_COLUMNS[id];
  return {
    enabled: row?.[col.enabled] ?? null,
    clientId: row?.[col.clientId] ?? null,
    secretBlob: row?.[col.secret] ?? null,
    // Only GitLab has an instance URL; the others are always the vendor's.
    issuer: id === "gitlab" ? (row?.gitlabOauthIssuer ?? env.GITLAB_OAUTH_ISSUER ?? null) : null,
  };
}

/**
 * Fully-resolved providers, ready to hand to better-auth's `socialProviders`.
 * A provider is included only when it is enabled AND has both halves of its
 * credential — a half-configured provider is omitted rather than registered
 * broken, so the sign-in page never shows a button that dead-ends.
 *
 * `enabled` defaults to "yes, if credentials exist" so an install that had
 * env-configured SSO before this table existed keeps working untouched.
 */
export async function resolvedSocialProviders(): Promise<ResolvedSocialProvider[]> {
  const row = await loadRow();
  const resolved: ResolvedSocialProvider[] = [];

  for (const id of SOCIAL_PROVIDER_IDS) {
    const stored = dbProvider(row, id);
    const seed = PROVIDER_ENV[id];
    if (stored.enabled === false) continue;

    const clientId = stored.clientId ?? seed.clientId ?? null;
    const clientSecret = (await decryptOrNull(stored.secretBlob)) ?? seed.clientSecret ?? null;
    if (!clientId || !clientSecret) continue;

    resolved.push({
      id,
      clientId,
      clientSecret,
      ...(id === "gitlab" && stored.issuer ? { issuer: stored.issuer } : {}),
    });
  }
  return resolved;
}

// ─── External notification transports ─────────────────────────────────

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/** Null when SMS isn't configured from either source — the caller logs a
 *  no-op rather than failing the notification (the in-app row still lands). */
export async function twilioConfig(): Promise<TwilioConfig | null> {
  const row = await loadRow();
  const accountSid = row?.twilioAccountSid ?? env.TWILIO_ACCOUNT_SID ?? null;
  const fromNumber = row?.twilioFromNumber ?? env.TWILIO_FROM_NUMBER ?? null;
  const authToken =
    (await decryptOrNull(row?.twilioAuthTokenCiphertext)) ?? env.TWILIO_AUTH_TOKEN ?? null;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

/** FCM server key, or null when push isn't configured. */
export async function fcmServerKey(): Promise<string | null> {
  const row = await loadRow();
  return (await decryptOrNull(row?.fcmServerKeyCiphertext)) ?? env.FCM_SERVER_KEY ?? null;
}

// ─── Firewall / CrowdSec ──────────────────────────────────────────────

export interface CrowdsecConfig {
  apiUrl: string;
  apiKey: string;
}

/**
 * CrowdSec bouncer credentials for the Caddy global block + the Firewall
 * page's LAPI reads. Null when disabled or incompletely configured. Note
 * this says nothing about whether the agent container is actually running —
 * that's the compose `firewall` profile, which the control plane can't start
 * for you.
 */
export async function crowdsecConfig(): Promise<CrowdsecConfig | null> {
  const row = await loadRow();
  if (row?.crowdsecEnabled === false) return null;
  const apiUrl = row?.crowdsecLapiUrl ?? env.CROWDSEC_LAPI_URL ?? null;
  const apiKey =
    (await decryptOrNull(row?.crowdsecBouncerKeyCiphertext)) ?? env.CROWDSEC_BOUNCER_KEY ?? null;
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey };
}

// ─── Outbound egress allowlist ────────────────────────────────────────

/** Parse the comma-separated grammar env uses, so a UI-typed value and an
 *  env-supplied one are normalized identically. */
function parseAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Bare IPs/CIDRs tenant-supplied destinations may reach. An empty *string* in
 * the column is an explicit "allow nothing" that overrides a non-empty env —
 * only NULL falls back. This can never re-permit the control plane's own
 * addresses; that denial lives in egress-denylist.ts and is unconditional.
 */
export async function egressAllowlistEntries(): Promise<string[]> {
  const row = await loadRow();
  return row?.egressAllowlist === null || row?.egressAllowlist === undefined
    ? env.OTTERDEPLOY_EGRESS_ALLOWLIST
    : parseAllowlist(row.egressAllowlist);
}

// ─── PR previews ──────────────────────────────────────────────────────

/** Hours of inactivity before an open preview is reaped; 0 disables it. */
export async function previewIdleTeardownHours(): Promise<number> {
  const row = await loadRow();
  return row?.previewIdleTeardownHours ?? env.PREVIEW_IDLE_TEARDOWN_HOURS;
}

/** Most previews one project may have open at once; 0 disables the cap. */
export async function previewMaxPerProject(): Promise<number> {
  const row = await loadRow();
  return row?.previewMaxPerProject ?? env.PREVIEW_MAX_PER_PROJECT;
}

// ─── Edge logs ────────────────────────────────────────────────────────

export const DEFAULT_EDGE_LOG_RETENTION_DAYS = 7;

export async function edgeLogPersistEnabled(): Promise<boolean> {
  const row = await loadRow();
  return row?.edgeLogPersist ?? env.EDGE_LOG_PERSIST;
}

export async function edgeLogRetentionDays(): Promise<number> {
  const row = await loadRow();
  return row?.edgeLogRetentionDays ?? DEFAULT_EDGE_LOG_RETENTION_DAYS;
}

export async function edgeLogGeoipUrls(): Promise<{ country: string; asn: string }> {
  const row = await loadRow();
  return {
    country: row?.edgeLogGeoipUrl ?? env.EDGE_LOG_GEOIP_URL,
    asn: row?.edgeLogGeoipAsnUrl ?? env.EDGE_LOG_GEOIP_ASN_URL,
  };
}

// ─── Build pipeline ───────────────────────────────────────────────────

/** Read once at builder-worker start; changing it needs a builder restart. */
export async function builderConcurrency(): Promise<number> {
  const row = await loadRow();
  return row?.builderConcurrency ?? env.BUILDER_CONCURRENCY;
}
