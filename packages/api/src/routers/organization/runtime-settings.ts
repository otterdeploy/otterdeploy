/**
 * Read/write handlers for the runtime configuration that used to be env-only
 * (od-gfg): who may register, SMS/push transports, the CrowdSec bouncer, the
 * egress allowlist, and the assorted operator knobs. Social sign-in providers
 * live in ./social-providers.ts (they carry an auth-instance reload).
 *
 * Every writer here goes through `persist()`, which drops the resolver's
 * memoized settings row, skipping that is the one way a saved setting appears
 * not to apply. Writers whose effect isn't purely a later read do their extra
 * work at the router layer (saving CrowdSec re-renders the edge).
 *
 * Secrets follow the email transport's convention exactly: write-only, with
 * `undefined` meaning "leave unchanged", `null` meaning "clear", and reads
 * returning a `*Configured` boolean instead of the value.
 */

import { ORPCError } from "@orpc/server";
import { enabledSocialProviderIds } from "@otterdeploy/auth";
import {
  DEFAULT_SIGN_IN_METHODS,
  type SignInMethods,
  wouldLockOut,
} from "@otterdeploy/auth/sign-in-methods";
import { db } from "@otterdeploy/db";
import { ssoProvider, user as userTbl } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { DEFAULT_THRESHOLDS, normalizeThresholds } from "@otterdeploy/shared/thresholds";
import { count, eq } from "drizzle-orm";
import { log } from "evlog";

import { encryptSecret } from "../../lib/crypto";
import {
  crowdsecConfig,
  DEFAULT_EDGE_LOG_RETENTION_DAYS,
  invalidatePlatformRuntimeSettings,
} from "../../lib/platform-runtime-settings";

type PlatformRow = typeof platformSettings.$inferSelect;
type PlatformInsert = typeof platformSettings.$inferInsert;

async function readRow(): Promise<PlatformRow | undefined> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

/** Upsert a partial settings patch and drop the resolver's memo. */
async function persist(set: Partial<PlatformInsert>): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });
  invalidatePlatformRuntimeSettings();
}

// ─── Access / registration ────────────────────────────────────────────

export interface AccessSettingsView {
  registrationMode: "invite-only" | "open";
  bootstrapComplete: boolean;
}

export async function getAccessSettings(): Promise<AccessSettingsView> {
  const [row, [anyUser]] = await Promise.all([
    readRow(),
    db.select({ id: userTbl.id }).from(userTbl).limit(1),
  ]);
  return {
    registrationMode: row?.registrationMode === "open" ? "open" : "invite-only",
    bootstrapComplete: Boolean(anyUser || row?.bootstrapCompletedAt),
  };
}

export async function saveAccessSettings(
  mode: "invite-only" | "open",
): Promise<AccessSettingsView> {
  await persist({ registrationMode: mode });
  // Worth a durable line: this is the setting that decides whether strangers
  // can create accounts, and the audit trail should show every flip.
  log.info({ platform: { setting: "registration-mode", value: mode } });
  return getAccessSettings();
}

// ─── Sign-in methods ──────────────────────────────────────────────────

export interface SignInMethodsView extends SignInMethods {
  bootstrapComplete: boolean;
  liveSocialProviderCount: number;
  registeredSsoProviderCount: number;
}

/** The two counts the lock-out floor depends on, read together so the check
 *  and the view the operator is looking at cannot disagree. */
async function federatedCounts(): Promise<{
  liveSocialProviderCount: number;
  registeredSsoProviderCount: number;
}> {
  const [ssoCount] = await db.select({ value: count() }).from(ssoProvider);
  return {
    // What the LIVE auth instance registered, not what the columns claim: a
    // provider whose secret won't decrypt is not a way back in.
    liveSocialProviderCount: enabledSocialProviderIds().length,
    registeredSsoProviderCount: ssoCount?.value ?? 0,
  };
}

export async function getSignInMethods(): Promise<SignInMethodsView> {
  const [row, [anyUser], counts] = await Promise.all([
    readRow(),
    db.select({ id: userTbl.id }).from(userTbl).limit(1),
    federatedCounts(),
  ]);
  return {
    password: row?.signInPasswordEnabled ?? DEFAULT_SIGN_IN_METHODS.password,
    passkey: row?.signInPasskeyEnabled ?? DEFAULT_SIGN_IN_METHODS.passkey,
    sso: row?.signInSsoEnabled ?? DEFAULT_SIGN_IN_METHODS.sso,
    bootstrapComplete: Boolean(anyUser || row?.bootstrapCompletedAt),
    ...counts,
  };
}

/**
 * Save the method policy, refusing any save that would leave existing accounts
 * with no way in.
 *
 * The floor is enforced HERE and not only in the switch's disabled state,
 * because the disabled state is presentation: this endpoint is reachable with
 * an API key. `wouldLockOut` is the rule and it lives in the auth package next
 * to the request gate that reads the same columns, so there is one definition
 * of "locked out" rather than one per caller.
 */
export async function saveSignInMethods(methods: SignInMethods): Promise<SignInMethodsView> {
  const counts = await federatedCounts();
  if (wouldLockOut({ methods, ...counts })) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Turning off password sign-in would lock everyone out. Configure a social provider or register an SSO identity provider first, then disable passwords.",
    });
  }

  await persist({
    signInPasswordEnabled: methods.password,
    signInPasskeyEnabled: methods.passkey,
    signInSsoEnabled: methods.sso,
  });
  // Worth a durable line for the same reason the registration mode is: this
  // decides who can get into the installation at all.
  log.info({ platform: { setting: "sign-in-methods", ...methods } });
  return getSignInMethods();
}

// ─── SMS + push transports ────────────────────────────────────────────

// ─── CrowdSec ─────────────────────────────────────────────────────────

export interface CrowdsecSettingsView {
  enabled: boolean;
  lapiUrl: string | null;
  bouncerKeyConfigured: boolean;
  envConfigured: boolean;
  effective: boolean;
}

export async function getCrowdsecSettings(): Promise<CrowdsecSettingsView> {
  const row = await readRow();
  return {
    enabled: row?.crowdsecEnabled ?? true,
    lapiUrl: row?.crowdsecLapiUrl ?? env.CROWDSEC_LAPI_URL ?? null,
    bouncerKeyConfigured: Boolean(row?.crowdsecBouncerKeyCiphertext),
    envConfigured: Boolean(env.CROWDSEC_LAPI_URL && env.CROWDSEC_BOUNCER_KEY),
    effective: (await crowdsecConfig()) !== null,
  };
}

export interface SaveCrowdsecSettingsInput {
  enabled: boolean;
  lapiUrl: string | null;
  bouncerKey?: string | null;
}

export async function saveCrowdsecSettings(
  input: SaveCrowdsecSettingsInput,
): Promise<CrowdsecSettingsView> {
  const set: Partial<PlatformInsert> = {
    crowdsecEnabled: input.enabled,
    crowdsecLapiUrl: input.lapiUrl,
  };
  if (input.bouncerKey !== undefined) {
    set.crowdsecBouncerKeyCiphertext = input.bouncerKey
      ? await encryptSecret(input.bouncerKey)
      : null;
  }
  await persist(set);
  return getCrowdsecSettings();
}

// ─── Assorted operator knobs ──────────────────────────────────────────

export interface RuntimeSettingsView {
  egressAllowlist: string;
  egressFromEnv: boolean;
  previewIdleTeardownHours: number;
  edgeLogPersist: boolean;
  edgeLogRetentionDays: number;
  edgeLogGeoipUrl: string;
  edgeLogGeoipAsnUrl: string;
  builderConcurrency: number;
  edgeLogSinkConfigured: boolean;
  /** One pair drives every meter's colour and every threshold alert. */
  alertWarnPct: number;
  alertCritPct: number;
}

/** The env-seeds/DB-owns rule in one place: a stored NULL defers to env, any
 *  other stored value (including `false`, `0` and `""`) wins. */
function resolve<T>(stored: T | null | undefined, fallback: T): T {
  return stored ?? fallback;
}

function toRuntimeView(row: PlatformRow | undefined): RuntimeSettingsView {
  const storedAllowlist = row?.egressAllowlist;
  return {
    egressAllowlist: resolve(storedAllowlist, env.OTTERDEPLOY_EGRESS_ALLOWLIST.join(",")),
    // Distinguishes "showing you the env value" from "you saved an empty
    // allowlist": the card says which, because they mean different things.
    egressFromEnv: storedAllowlist == null,
    previewIdleTeardownHours: resolve(
      row?.previewIdleTeardownHours,
      env.PREVIEW_IDLE_TEARDOWN_HOURS,
    ),
    edgeLogPersist: resolve(row?.edgeLogPersist, env.EDGE_LOG_PERSIST),
    edgeLogRetentionDays: resolve(row?.edgeLogRetentionDays, DEFAULT_EDGE_LOG_RETENTION_DAYS),
    edgeLogGeoipUrl: resolve(row?.edgeLogGeoipUrl, env.EDGE_LOG_GEOIP_URL),
    edgeLogGeoipAsnUrl: resolve(row?.edgeLogGeoipAsnUrl, env.EDGE_LOG_GEOIP_ASN_URL),
    builderConcurrency: resolve(row?.builderConcurrency, env.BUILDER_CONCURRENCY),
    edgeLogSinkConfigured: Boolean(env.EDGE_LOG_SINK),
    alertWarnPct: resolve(row?.alertWarnPct, DEFAULT_THRESHOLDS.warn),
    alertCritPct: resolve(row?.alertCritPct, DEFAULT_THRESHOLDS.crit),
  };
}

export async function getRuntimeSettings(): Promise<RuntimeSettingsView> {
  return toRuntimeView(await readRow());
}

export interface SaveRuntimeSettingsInput {
  egressAllowlist: string;
  previewIdleTeardownHours: number;
  edgeLogPersist: boolean;
  edgeLogRetentionDays: number;
  edgeLogGeoipUrl: string;
  edgeLogGeoipAsnUrl: string;
  builderConcurrency: number;
  alertWarnPct: number;
  alertCritPct: number;
}

export async function saveRuntimeSettings(
  input: SaveRuntimeSettingsInput,
): Promise<RuntimeSettingsView> {
  // Normalised rather than trusted. The contract schema already rejects an
  // inverted pair, but this is the last gate before the number that colours
  // every meter AND the number alert evaluation reads — they are the same
  // number precisely so they cannot drift apart.
  const thresholds = normalizeThresholds({ warn: input.alertWarnPct, crit: input.alertCritPct });
  await persist({
    // Stored verbatim (including ""), because an empty allowlist is a real
    // choice: "allow nothing" has to be able to override a non-empty env.
    egressAllowlist: input.egressAllowlist,
    previewIdleTeardownHours: input.previewIdleTeardownHours,
    edgeLogPersist: input.edgeLogPersist,
    edgeLogRetentionDays: input.edgeLogRetentionDays,
    edgeLogGeoipUrl: input.edgeLogGeoipUrl,
    edgeLogGeoipAsnUrl: input.edgeLogGeoipAsnUrl,
    builderConcurrency: input.builderConcurrency,
    alertWarnPct: thresholds.warn,
    alertCritPct: thresholds.crit,
  });
  return getRuntimeSettings();
}
