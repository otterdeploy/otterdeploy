/**
 * Reachability check for custom domains (the add-and-go model's "is this
 * pointed at us yet?" pre-flight). Resolves the domain's A/AAAA via public
 * resolvers and classifies where it lands:
 *
 *   pointed   — resolves to our server IP ⇒ earns a real Let's Encrypt cert
 *   proxied   — resolves into a Cloudflare edge range ⇒ Cloudflare
 *               terminates TLS; origin serves `tls internal` (Full mode)
 *   unpointed — resolves elsewhere / not at all ⇒ self-signed until the
 *               operator points DNS here (non-blocking)
 *   unknown   — lookup failed at the transport level (can't classify)
 *
 * This is intentionally a *reachability* check, not an ownership proof:
 * Let's Encrypt's own HTTP-01 challenge is the proof of control (Caddy
 * can only get a cert for a name that actually points here), so a working
 * A record + an issued cert is the verification.
 */

import { isCloudflareIp } from "./cloudflare-ips";
import { resolveAddressesRobust } from "./dns-resolver";

export type DnsState = "pointed" | "proxied" | "unpointed" | "unknown";

export interface ReachabilityResult {
  state: DnsState;
  /** Every address the domain resolved to (for UI diagnostics). */
  addresses: string[];
}

export async function checkDomainReachability(input: {
  domain: string;
  /** Our server's public IP (from platform settings). When absent we can't
   *  distinguish "pointed" from "unpointed", so a non-Cloudflare answer
   *  falls back to "unknown" rather than a misleading "unpointed". */
  serverIp: string | null;
}): Promise<ReachabilityResult> {
  let addresses: string[];
  try {
    addresses = await resolveAddressesRobust(input.domain);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Authoritative "no such record" ⇒ definitely not pointed here.
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") {
      return { state: "unpointed", addresses: [] };
    }
    return { state: "unknown", addresses: [] };
  }

  if (addresses.length === 0) return { state: "unpointed", addresses };

  if (input.serverIp && addresses.includes(input.serverIp)) {
    return { state: "pointed", addresses };
  }
  if (addresses.some(isCloudflareIp)) {
    return { state: "proxied", addresses };
  }
  // Resolves somewhere, but not at us and not Cloudflare. If we don't know
  // our own IP we can't be sure it's wrong — call it unknown.
  return { state: input.serverIp ? "unpointed" : "unknown", addresses };
}
