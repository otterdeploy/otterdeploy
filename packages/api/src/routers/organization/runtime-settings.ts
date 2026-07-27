/**
 * Read/write handlers for the runtime configuration that used to be env-only
 * (od-gfg): who may register, SMS/push transports, the CrowdSec bouncer, the
 * egress allowlist, and the assorted operator knobs. Social sign-in providers
 * live in ./social-providers.ts (they carry an auth-instance reload).
 *
 * Every writer here goes through `persist()`, which drops the resolver's
 * memoized settings row — skipping that is the one way a saved setting appears
 * not to apply. Writers whose effect isn't purely a later read do their extra
 * work at the router layer (saving CrowdSec re-renders the edge).
 *
 * Secrets follow the email transport's convention exactly: write-only, with
 * `undefined` meaning "leave unchanged", `null` meaning "clear", and reads
 * returning a `*Configured` boolean instead of the value.
 */

import { db } from "@otterdeploy/db";
import { user as userTbl } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";
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
    // allowlist" — the card says which, because they mean different things.
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
}

export async function saveRuntimeSettings(
  input: SaveRuntimeSettingsInput,
): Promise<RuntimeSettingsView> {
  await persist({
    // Stored verbatim (including ""), because an empty allowlist is a real
    // choice — "allow nothing" has to be able to override a non-empty env.
    egressAllowlist: input.egressAllowlist,
    previewIdleTeardownHours: input.previewIdleTeardownHours,
    edgeLogPersist: input.edgeLogPersist,
    edgeLogRetentionDays: input.edgeLogRetentionDays,
    edgeLogGeoipUrl: input.edgeLogGeoipUrl,
    edgeLogGeoipAsnUrl: input.edgeLogGeoipAsnUrl,
    builderConcurrency: input.builderConcurrency,
  });
  return getRuntimeSettings();
}
