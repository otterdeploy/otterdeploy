/**
 * Control-plane-identity denylist for outbound egress from job workers
 * (webhook delivery, notification channels) — mirrors
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
 * even when the install sits behind NAT. Unconditional — never overridden
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

/** The operator-configured egress allowlist (bare IPs/CIDRs) — see
 *  packages/env/src/server.ts's `OTTERDEPLOY_EGRESS_ALLOWLIST`. */
export function egressAllowlist(): string[] {
  return env.OTTERDEPLOY_EGRESS_ALLOWLIST;
}
