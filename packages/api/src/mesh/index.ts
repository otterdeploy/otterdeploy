/**
 * Private-networking provider layer. Everything above this module is
 * provider-blind — it deals in `MeshProviderClient`, never in NetBird or
 * Tailscale specifics.
 *
 * Design: docs/designs/vpn-mesh.md
 */

import type { MeshProviderClient, MeshProviderKind } from "./types";

import { decryptForDomain } from "../lib/crypto";
import { NetbirdClient } from "./netbird";
import { MeshProviderError } from "./types";

export * from "./types";
export { NETBIRD_HOSTED_URL, normalizeManagementUrl } from "./netbird";

/** The subset of a `mesh_network` row the provider layer needs. */
export interface MeshCredentials {
  provider: MeshProviderKind;
  managementUrl: string;
  apiTokenCiphertext: string;
}

/**
 * Build a provider client from a stored row, decrypting the credential at the
 * last possible moment. Throws for a provider we haven't implemented yet
 * rather than silently degrading — a half-working mesh is worse than an
 * honest error.
 */
export async function createMeshClient(
  credentials: MeshCredentials,
  fetchImpl?: typeof fetch,
): Promise<MeshProviderClient> {
  const token = await decryptForDomain(credentials.apiTokenCiphertext, "mesh-creds");

  switch (credentials.provider) {
    case "netbird":
      return new NetbirdClient({
        managementUrl: credentials.managementUrl,
        token,
        fetchImpl,
      });
    case "tailscale":
      // Phase 5 (od-c1i). The row can already carry provider="tailscale", so
      // fail loudly here rather than pretending the connection works.
      throw new MeshProviderError({
        provider: "tailscale",
        status: null,
        message: "Tailscale support isn't implemented yet — connect a NetBird account for now.",
      });
  }
}

/**
 * The internal hostname a private route is served on.
 *
 * NetBird: the node peer registers ONE wildcard extra DNS label at join
 * (`--extra-dns-labels "*.<dnsLabel>"`), so every service under that label
 * resolves to the node's mesh IP with no per-service API call and no external
 * DNS. Caddy fans the wildcard back out by Host header — exactly what the
 * public reconciler already does for real domains.
 *
 *     <service>-<project>.<dnsLabel>.<peerDomain>
 *     e.g.  api-storefront.od.netbird.cloud
 */
export function privateHostFor(input: {
  provider: MeshProviderKind;
  serviceSlug: string;
  projectSlug: string;
  dnsLabel: string;
  peerDomain: string;
}): string {
  const leaf = `${input.serviceSlug}-${input.projectSlug}`;
  return `${leaf}.${input.dnsLabel}.${input.peerDomain}`;
}
