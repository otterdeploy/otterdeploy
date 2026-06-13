/**
 * First-boot resolver for `platform_settings.server_ip` — the public IP
 * embedded in sslip.io fallback domains (`<ip>.sslip.io`). Without it the
 * resolver in `./domains.ts` degrades to `127.0.0.1`, so "public" services
 * publish a loopback URL that's reachable from nowhere.
 *
 * Precedence (every boot):
 *   1. Operator override (env SERVER_IP) — authoritative, re-applied each
 *      boot so changing the env actually takes effect.
 *   2. Already-persisted value — sticky; a detected/typed IP is never
 *      silently overwritten.
 *   3. Auto-detect from a public-IP echo service — only when `allowDetect`
 *      (production). A dev box's WAN IP isn't reachable on :443, so dev
 *      skips detection rather than persist a misleading address.
 *
 * Unlike Coolify — which takes the IP the operator typed when adding a
 * server over SSH and never calls an echo service — otterdeploy runs *on*
 * the single node it deploys to, so there's no "add server" step to carry
 * the IP. Detection fills that gap; the env override mirrors Coolify's
 * operator-provided value for when detection is wrong (NAT, multi-homed).
 */

import { eq } from "drizzle-orm";
import { Result } from "better-result";

import { db } from "@otterdeploy/db";
import {
  PLATFORM_SETTINGS_ID,
  platformSettings,
} from "@otterdeploy/db/schema/platform";

export type ServerIpSource = "override" | "existing" | "detected" | "none";

export interface EnsureServerIpResult {
  ip: string | null;
  source: ServerIpSource;
}

// Plain-text echo services — the response body is the caller's public IP.
// Tried in order; first that answers with something IP-shaped wins.
const IP_ECHO_SERVICES = [
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
  "https://icanhazip.com",
];

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Loose check — rejects HTML/error bodies, not a full RFC validation. */
function looksLikeIp(value: string): boolean {
  if (IPV4.test(value)) return true;
  // ipv6: only hex + colons, and at least one colon.
  return value.includes(":") && /^[0-9a-fA-F:]+$/.test(value);
}

async function detectPublicIp(): Promise<string | null> {
  for (const url of IP_ECHO_SERVICES) {
    const fetched = await Result.tryPromise({
      try: async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`${url} → ${res.status}`);
        return (await res.text()).trim();
      },
      catch: (cause) => cause,
    });
    if (fetched.isOk() && looksLikeIp(fetched.value)) return fetched.value;
  }
  return null;
}

async function persist(ip: string): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, serverIp: ip })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: { serverIp: ip },
    });
}

export async function ensureServerIp(opts: {
  override?: string | null;
  allowDetect: boolean;
}): Promise<EnsureServerIpResult> {
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  // 1. Operator override wins, and is re-applied so an env change lands.
  const override = opts.override?.trim();
  if (override) {
    if (row?.serverIp !== override) await persist(override);
    return { ip: override, source: "override" };
  }

  // 2. Keep a value we already have — detected or typed, it's trusted.
  if (row?.serverIp) return { ip: row.serverIp, source: "existing" };

  // 3. Nothing on record — detect (production only) and persist.
  const detected = opts.allowDetect ? await detectPublicIp() : null;
  if (!detected) return { ip: null, source: "none" };
  await persist(detected);
  return { ip: detected, source: "detected" };
}
