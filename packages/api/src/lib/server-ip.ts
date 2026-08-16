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
 *   4. A local non-internal IPv4 — when the echo services can't be reached at
 *      all. Better than the loopback the resolver would otherwise fall to.
 *
 * Otterdeploy runs *on* the single node it deploys to, so there's no
 * "add server" step where an operator would type the IP. Detection fills
 * that gap; the env override serves as the operator-provided value for
 * when detection is wrong (NAT, multi-homed).
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { networkInterfaces } from "node:os";

export type ServerIpSource = "override" | "existing" | "detected" | "local" | "none";

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

/**
 * od-bad: last resort before giving up — the first non-internal IPv4 this
 * container can see. Runs when the echo services are unreachable (no egress,
 * blocked outbound, air-gapped LAN install), where the alternative is
 * `domains.ts` degrading every generated domain to `127.0.0.1.sslip.io`: a URL
 * that renders as live and is reachable from nowhere. A LAN address is not
 * always the right answer, but it is always a better guess than loopback, and
 * the operator can correct it in Settings.
 *
 * Docker caveat: in a bridged container this sees the container's own address
 * on the compose network, not the host's. That's why `install.sh` writes
 * SERVER_IP from the host (precedence #1) — this only carries an install where
 * that didn't happen.
 */
function detectLocalIp(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
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
  if (detected) {
    await persist(detected);
    return { ip: detected, source: "detected" };
  }

  // 4. No public answer — fall back to a local interface rather than let the
  //    resolver silently mint loopback domains.
  const local = opts.allowDetect ? detectLocalIp() : null;
  if (local) {
    await persist(local);
    return { ip: local, source: "local" };
  }

  return { ip: null, source: "none" };
}
