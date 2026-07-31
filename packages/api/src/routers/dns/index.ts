/**
 * DNS inspection backing the "add a domain" flow.
 *
 * Detection (who runs this zone) is deliberately independent of capability
 * (can we write to it). Knowing a domain is on Cloudflare while holding no
 * token is exactly the case worth surfacing — it is what lets the UI offer
 * "connect your account" instead of dropping the operator into manual records
 * with no explanation of why the easy path wasn't offered.
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { eq } from "drizzle-orm";

import type { CloudflareZone } from "../../lib/cloudflare";

import { orgScopedProcedure } from "../../index";
import { listCloudflareZones } from "../../lib/cloudflare";
import { detectDnsProvider, detectProxied } from "../../lib/dns-detect";
import { getOrganizationById } from "../organization/queries";

/** The zone on this token that covers `domain`, or null. Longest match wins so
 *  a delegated `dev.acme.com` zone beats `acme.com` when both are present. */
async function matchingCloudflareZoneId(token: string, domain: string): Promise<string | null> {
  // A failed listing degrades to "no matching zone", same as an empty one —
  // the caller's next step is to ask the operator to pick a zone by hand.
  const zones = (await listCloudflareZones(token)).unwrapOr<CloudflareZone[]>([]);
  const name = domain.toLowerCase().replace(/\.$/, "");
  const matches = zones
    .filter((z) => {
      const zn = z.name.toLowerCase();
      return name === zn || name.endsWith(`.${zn}`);
    })
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0]?.id ?? null;
}

export const dnsRouter = {
  inspect: orgScopedProcedure.dns.inspect.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });

    const domain = input.domain.trim().toLowerCase().replace(/\.$/, "");

    const [detected, org, [settings]] = await Promise.all([
      detectDnsProvider(domain),
      getOrganizationById(context.activeOrganizationId),
      db
        .select({ serverIp: platformSettings.serverIp })
        .from(platformSettings)
        .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
        .limit(1),
    ]);

    const token = org?.cloudflareApiToken ?? null;
    // Only ask Cloudflare which zones exist when the nameservers already say
    // it's Cloudflare — otherwise this is a pointless round trip on every
    // keystroke-triggered inspect for a domain hosted elsewhere.
    const zoneId =
      token && detected.provider === "cloudflare"
        ? await matchingCloudflareZoneId(token, domain)
        : null;

    const proxy = await detectProxied({
      domain,
      expectedOrigin: settings?.serverIp ?? null,
    });

    return {
      provider: detected.provider,
      zone: detected.zone,
      nameservers: detected.nameservers,
      lookupFailed: detected.lookupFailed,
      cloudflare: {
        connected: Boolean(token),
        zoneId,
        canAutoConfigure: Boolean(zoneId),
      },
      proxied: proxy.proxied,
      resolvedAddresses: proxy.resolved,
    };
  }),
};
