/**
 * Version detection + update settings, persisted to the single platform_settings
 * row (the org/email-settings pattern). The CURRENT version is read live from
 * env (the booted image tag); the LATEST comes from the release source, with a
 * testing override. `checkForUpdate` caches its result on the row so the "update
 * available" badge survives a page reload without re-hitting the network.
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";

import { isNewer } from "./compare";
import { fetchLatestRelease, type LatestRelease } from "./release-source";

export interface VersionInfo {
  current: string;
  channel: string;
  runtime: "docker" | "swarm";
  /** Whether apply runs in simulation (dev default / forced) — the UI badges it
   *  so a dry-run "update" is never mistaken for the real thing. */
  dryRun: boolean;
}

export interface UpdateSettings {
  channel: string;
  autoUpdateEnabled: boolean;
  lastCheckedAt: string | null;
  availableVersion: string | null;
  availableReleaseNotes: string | null;
  availableReleaseUrl: string | null;
  dismissedVersion: string | null;
}

export interface CheckResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  notes: string | null;
  url: string | null;
  checkedAt: string;
  /** Latest resolved from OTTERDEPLOY_LATEST_VERSION_OVERRIDE (a test), not a
   *  real release — surfaced so the UI can label it honestly. */
  simulated: boolean;
}

/** The version the running image booted with (the compose image tag). */
export function currentVersion(): string {
  return env.OTTERDEPLOY_VERSION;
}

/** Dry-run defaults ON in dev, OFF in production, unless explicitly overridden. */
export function resolveDryRun(): boolean {
  return env.OTTERDEPLOY_UPDATE_DRY_RUN ?? env.NODE_ENV !== "production";
}

async function loadRow() {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const row = await loadRow();
  return {
    current: currentVersion(),
    channel: row?.updateChannel ?? "stable",
    runtime: env.DEPLOY_RUNTIME,
    dryRun: resolveDryRun(),
  };
}

const DEFAULT_SETTINGS: UpdateSettings = {
  channel: "stable",
  autoUpdateEnabled: false,
  lastCheckedAt: null,
  availableVersion: null,
  availableReleaseNotes: null,
  availableReleaseUrl: null,
  dismissedVersion: null,
};

export async function getUpdateSettings(): Promise<UpdateSettings> {
  const row = await loadRow();
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    channel: row.updateChannel ?? "stable",
    autoUpdateEnabled: row.autoUpdateEnabled ?? false,
    lastCheckedAt: row.lastUpdateCheckedAt?.toISOString() ?? null,
    availableVersion: row.availableVersion ?? null,
    availableReleaseNotes: row.availableReleaseNotes ?? null,
    availableReleaseUrl: row.availableReleaseUrl ?? null,
    dismissedVersion: row.dismissedVersion ?? null,
  };
}

export interface SaveUpdateSettingsInput {
  channel?: string;
  autoUpdateEnabled?: boolean;
  /** Set to the currently-available version to dismiss its banner; null clears. */
  dismissedVersion?: string | null;
}

export async function saveUpdateSettings(input: SaveUpdateSettingsInput): Promise<UpdateSettings> {
  const set: Partial<typeof platformSettings.$inferInsert> = {};
  if (input.channel !== undefined) set.updateChannel = input.channel;
  if (input.autoUpdateEnabled !== undefined) set.autoUpdateEnabled = input.autoUpdateEnabled;
  if (input.dismissedVersion !== undefined) set.dismissedVersion = input.dismissedVersion;

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });
  return getUpdateSettings();
}

/** Resolve the latest version — the testing override short-circuits the network
 *  fetch so the whole UI can be exercised with no real release. */
async function resolveLatest(): Promise<{ release: LatestRelease | null; simulated: boolean }> {
  const override = env.OTTERDEPLOY_LATEST_VERSION_OVERRIDE;
  if (override) {
    return {
      simulated: true,
      release: {
        version: override,
        notes:
          "Simulated release — OTTERDEPLOY_LATEST_VERSION_OVERRIDE is set, so this is a test target, not a real published version.",
        url: null,
      },
    };
  }
  return { release: await fetchLatestRelease(), simulated: false };
}

/** Check the release source, compare to current, and cache the result on the
 *  platform row. Never throws — an unreachable source yields updateAvailable:false. */
export async function checkForUpdate(): Promise<CheckResult> {
  const current = currentVersion();
  const { release, simulated } = await resolveLatest();
  const checkedAt = new Date();
  const latest = release?.version ?? null;
  const notes = release?.notes ?? null;
  const url = release?.url ?? null;
  const updateAvailable = isNewer(current, latest);

  const set: Partial<typeof platformSettings.$inferInsert> = {
    lastUpdateCheckedAt: checkedAt,
    availableVersion: updateAvailable ? latest : null,
    availableReleaseNotes: updateAvailable ? notes : null,
    availableReleaseUrl: updateAvailable ? url : null,
  };
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });

  return {
    current,
    latest,
    updateAvailable,
    notes,
    url,
    checkedAt: checkedAt.toISOString(),
    simulated,
  };
}
