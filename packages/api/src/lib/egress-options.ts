import { egressAllowlistEntries } from "./platform-runtime-settings";

/**
 * The operator-configured egress allowlist — bare IPs/CIDRs a homelab/LAN
 * operator has explicitly opted in to letting tenant-supplied destinations
 * reach. Empty by default. Thread this into every `egressFetch` /
 * `isForbiddenEgressAddress` call's `allowAddresses`.
 *
 * Editable in Settings → Instance and seeded from
 * OTTERDEPLOY_EGRESS_ALLOWLIST; async because resolving it reads the settings
 * row (memoized, so hot paths don't pay for it). It can never re-permit the
 * control plane's own addresses — that denial lives in ./egress-denylist.ts
 * and is unconditional.
 */
export async function egressAllowlist(): Promise<string[]> {
  return egressAllowlistEntries();
}
