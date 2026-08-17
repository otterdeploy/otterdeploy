/**
 * Control-plane-identity denylist for outbound egress from job workers
 * (webhook delivery, notification channels): mirrors
 * packages/api/src/lib/egress-denylist.ts. Duplicated rather than imported
 * because packages/api depends on packages/jobs (not the other way), so
 * jobs can't reach into api's lib; both packages already depend on
 * @otterdeploy/db and @otterdeploy/env directly.
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";

function hostnameOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Public identities of this control plane. Outbound webhook/notification
 * deliveries deny both their hostnames and the detected public IP so a
 * tenant-supplied target cannot call back into administrative endpoints,
 * even when the install sits behind NAT. Unconditional, never overridden
 * by `OTTERDEPLOY_EGRESS_ALLOWLIST`.
 */
export async function controlPlaneEgressDenylist(): Promise<{
  blockedHosts: string[];
  blockedAddresses: string[];
}> {
  const [settings] = await db
    .select({
      serverIp: platformSettings.serverIp,
      controlPlaneFqdn: platformSettings.controlPlaneFqdn,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  const configuredOrigins = [
    env.BETTER_AUTH_URL,
    env.PUBLIC_API_URL,
    env.PUBLIC_WEB_URL,
    ...env.CORS_ORIGIN,
  ];
  const blockedHosts = new Set(
    configuredOrigins.map(hostnameOf).filter((host): host is string => host !== null),
  );
  if (settings?.controlPlaneFqdn) {
    blockedHosts.add(settings.controlPlaneFqdn.replace(/\.$/, "").toLowerCase());
  }
  return {
    blockedHosts: [...blockedHosts],
    blockedAddresses: settings?.serverIp ? [settings.serverIp] : [],
  };
}

/**
 * The operator-configured egress allowlist (bare IPs/CIDRs). Editable in
 * Settings → Instance and seeded from OTTERDEPLOY_EGRESS_ALLOWLIST: the
 * column is authoritative once set, and an EMPTY string there is a deliberate
 * "allow nothing" that overrides a non-empty env, so only NULL falls back.
 *
 * Mirrors packages/api/src/lib/platform-runtime-settings.ts's resolution for
 * the same dependency reason this whole module is duplicated (see the header):
 * `api` depends on `jobs`, so the import can't go the other way. The parsing
 * is kept byte-identical to the env transform so a value typed in the UI and
 * one supplied via env normalize the same.
 */
export async function egressAllowlist(): Promise<string[]> {
  const [row] = await db
    .select({ egressAllowlist: platformSettings.egressAllowlist })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  const stored = row?.egressAllowlist;
  if (stored === null || stored === undefined) return env.OTTERDEPLOY_EGRESS_ALLOWLIST;
  return stored
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
