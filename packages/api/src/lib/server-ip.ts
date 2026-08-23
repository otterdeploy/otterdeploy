/**
 * First-boot resolver for `platform_settings.server_ip`: the public IP
 * embedded in sslip.io fallback domains (`<ip>.sslip.io`). Without it the
 * resolver in `./domains.ts` degrades to `127.0.0.1`, so "public" services
 * publish a loopback URL that's reachable from nowhere.
 *
 * Precedence (every boot):
 *   1. Operator override (env SERVER_IP): authoritative, re-applied each
 *      boot so changing the env actually takes effect.
 *   2. Already-persisted value: sticky; a detected/typed IP is never
 *      silently overwritten.
 *   3. Auto-detect from a public-IP echo service: only when `allowDetect`
 *      (production). A dev box's WAN IP isn't reachable on :443, so dev
 *      skips detection rather than persist a misleading address.
 *   4. A local non-internal IPv4: when the echo services can't be reached at
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
import { z } from "zod";

export type ServerIpSource = "override" | "existing" | "detected" | "local" | "none";

export interface EnsureServerIpResult {
  ip: string | null;
  source: ServerIpSource;
}

// Plain-text echo services: the response body is the caller's public IP.
// Tried in order; first that answers with something IP-shaped wins.
const IP_ECHO_SERVICES = [
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
  "https://icanhazip.com",
];

// IPv6-ONLY echo services: they answer over v6 or not at all, which is what
// makes them a detector. A dual-stack endpoint would happily reply over v4
// with the v4 address and we'd persist that as the host's "IPv6".
const IPV6_ECHO_SERVICES = ["https://api6.ipify.org", "https://ipv6.icanhazip.com"];

// Zod's address formats are the single definition of "is this an address"
// across the codebase (the settings contract validates the same way), so an
// echo service's answer is held to exactly the standard an operator's typed
// value is. Rejects HTML/error bodies for free.
const ipv4 = z.ipv4();
const ipv6 = z.ipv6();

function looksLikeIp(value: string): boolean {
  return ipv4.safeParse(value).success || ipv6.safeParse(value).success;
}

/** v6 literals only: keeps a v4 answer from a mis-behaving "IPv6" endpoint
 *  out of the v6 column. */
function looksLikeIpv6(value: string): boolean {
  return ipv6.safeParse(value).success;
}

async function detectFrom(services: readonly string[], accept: (v: string) => boolean) {
  for (const url of services) {
    const fetched = await Result.tryPromise({
      try: async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`${url} → ${res.status}`);
        return (await res.text()).trim();
      },
      catch: (cause) => cause,
    });
    if (fetched.isOk() && accept(fetched.value)) return fetched.value;
  }
  return null;
}

async function detectPublicIp(): Promise<string | null> {
  return detectFrom(IP_ECHO_SERVICES, looksLikeIp);
}

/** The host's public IPv6, or null when it has no v6 egress at all (the
 *  common IPv4-only VPS). Never falls back to a local interface the way the
 *  v4 path does: link-local/ULA addresses are unroutable, so publishing one
 *  as "your IPv6" would be a worse answer than admitting there isn't one. */
async function detectPublicIpv6(): Promise<string | null> {
  return detectFrom(IPV6_ECHO_SERVICES, looksLikeIpv6);
}

/**
 * od-bad: last resort before giving up: the first non-internal IPv4 this
 * container can see. Runs when the echo services are unreachable (no egress,
 * blocked outbound, air-gapped LAN install), where the alternative is
 * `domains.ts` degrading every generated domain to `127.0.0.1.sslip.io`: a URL
 * that renders as live and is reachable from nowhere. A LAN address is not
 * always the right answer, but it is always a better guess than loopback, and
 * the operator can correct it in Settings.
 *
 * Docker caveat: in a bridged container this sees the container's own address
 * on the compose network, not the host's. That's why `install.sh` writes
 * SERVER_IP from the host (precedence #1): this only carries an install where
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

async function persistAddress(patch: { serverIp: string } | { serverIpv6: string }): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...patch })
    .onConflictDoUpdate({ target: platformSettings.id, set: patch });
}

/**
 * The shared precedence both address families obey: operator override
 * (re-applied every boot so an env change actually lands) → the value already
 * on record (detected or typed, never silently overwritten) → detection →
 * whatever last resort the family has.
 *
 * Parameterized rather than written twice: the two differ only in which
 * column they touch, which detector they call, and whether a local-interface
 * guess is acceptable at the end.
 */
async function resolveAddress(
  opts: { override?: string | null; allowDetect: boolean },
  family: {
    read: () => Promise<string | null>;
    write: (ip: string) => Promise<void>;
    detect: () => Promise<string | null>;
    lastResort?: () => string | null;
  },
): Promise<EnsureServerIpResult> {
  const stored = await family.read();

  const override = opts.override?.trim();
  if (override) {
    if (stored !== override) await family.write(override);
    return { ip: override, source: "override" };
  }

  if (stored) return { ip: stored, source: "existing" };

  const detected = opts.allowDetect ? await family.detect() : null;
  if (detected) {
    await family.write(detected);
    return { ip: detected, source: "detected" };
  }

  const local = opts.allowDetect ? (family.lastResort?.() ?? null) : null;
  if (local) {
    await family.write(local);
    return { ip: local, source: "local" };
  }

  return { ip: null, source: "none" };
}

async function readColumn(column: "serverIp" | "serverIpv6"): Promise<string | null> {
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp, serverIpv6: platformSettings.serverIpv6 })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row?.[column] ?? null;
}

export async function ensureServerIp(opts: {
  override?: string | null;
  allowDetect: boolean;
}): Promise<EnsureServerIpResult> {
  return resolveAddress(opts, {
    read: () => readColumn("serverIp"),
    write: (ip) => persistAddress({ serverIp: ip }),
    detect: detectPublicIp,
    // No public answer: a LAN address beats letting the domain resolver mint
    // `127.0.0.1.sslip.io` for everything.
    lastResort: detectLocalIp,
  });
}

/**
 * IPv6 sibling of `ensureServerIp`, with one deliberate difference: there is
 * no local-interface last resort. An IPv4-only host is an ordinary host, so
 * `null` here means "this machine has no public IPv6" — which the Instance
 * page states plainly rather than rendering as a gap the operator must fix,
 * and a link-local/ULA guess would be unroutable anyway.
 */
export async function ensureServerIpv6(opts: {
  override?: string | null;
  allowDetect: boolean;
}): Promise<EnsureServerIpResult> {
  return resolveAddress(opts, {
    read: () => readColumn("serverIpv6"),
    write: (ip) => persistAddress({ serverIpv6: ip }),
    detect: detectPublicIpv6,
  });
}
