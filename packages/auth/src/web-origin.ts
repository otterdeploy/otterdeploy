/**
 * DB-backed resolver for the canonical web origin — reads the platform's
 * control-plane domain row and defers the decision to `canonicalWebOrigin`.
 * Split from that pure helper so the helper stays unit-testable without
 * env/db side effects.
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import { canonicalWebOrigin, type ControlPlaneDomainSettings } from "./canonical-origin";

/** Env-configured web origin (trailing slash trimmed) — the WEB host where
 *  routes like /accept-invite and /device render, NOT necessarily the API
 *  authority. Same resolution the device flow has always used. */
export function envWebOrigin(): string {
  return (env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL).replace(/\/+$/, "");
}

/** Brief cache of the platform_settings read: some consumers sit on
 *  per-request paths (the deploy-protection login redirect), and the
 *  control-plane domain changes at operator-action frequency, so ≤30s of
 *  staleness is invisible while keeping those paths off the DB. Failed
 *  reads are NOT cached — the next call retries. */
const SETTINGS_CACHE_TTL_MS = 30_000;
let settingsCache: { value: ControlPlaneDomainSettings | null; readAt: number } | null = null;

async function readControlPlaneSettings(): Promise<ControlPlaneDomainSettings | null> {
  if (settingsCache && Date.now() - settingsCache.readAt < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.value;
  }
  const [row] = await db
    .select({
      controlPlaneFqdn: platformSettings.controlPlaneFqdn,
      controlPlaneFqdnVerifiedAt: platformSettings.controlPlaneFqdnVerifiedAt,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  settingsCache = { value: row ?? null, readAt: Date.now() };
  return settingsCache.value;
}

/**
 * The origin outbound links should be built against: the VERIFIED
 * control-plane FQDN when the operator has configured one, else the given
 * fallback (each call site keeps its own env resolution — e.g. the GitHub
 * install callbacks prefer PUBLIC_WEB_URL; omitted ⇒ `envWebOrigin()`).
 * Never throws — a failed settings read (early boot, migration in flight)
 * degrades to the fallback so email sends and redirects aren't blocked on it.
 */
export async function resolveCanonicalWebOrigin(fallbackBase?: string): Promise<string> {
  const fallback = fallbackBase ?? envWebOrigin();
  try {
    return canonicalWebOrigin(await readControlPlaneSettings(), fallback);
  } catch (error) {
    log.warn({
      webOrigin: {
        status: "settings-read-failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    });
    return canonicalWebOrigin(null, fallback);
  }
}
