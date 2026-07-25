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

/** Public identities of this control plane. Outbound blocklist fetches deny
 * both their hostnames and known public IP so custom lists cannot call back
 * into administrative endpoints even when the install sits behind NAT. */
export async function blocklistEgressDenylist(): Promise<{
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
