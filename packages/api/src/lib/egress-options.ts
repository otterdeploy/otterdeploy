import { env } from "@otterdeploy/env/server";

/**
 * The operator-configured egress allowlist (`OTTERDEPLOY_EGRESS_ALLOWLIST`)
 * — bare IPs/CIDRs a homelab/LAN operator has explicitly opted in to letting
 * tenant-supplied destinations reach. Empty by default. Thread this into
 * every `egressFetch`/`isForbiddenEgressAddress` call's `allowAddresses`.
 */
export function egressAllowlist(): string[] {
  return env.OTTERDEPLOY_EGRESS_ALLOWLIST;
}
