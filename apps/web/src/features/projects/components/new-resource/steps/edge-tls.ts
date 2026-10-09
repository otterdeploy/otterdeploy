/**
 * What the wizard says about TLS for the service being created.
 *
 * The Edge proxy box used to state "Let's Encrypt · issued and renewed
 * automatically" for every service. A fresh install with no base domain
 * publishes at a generated sslip.io name, which no public CA signs, so that
 * route goes out on a self-signed certificate and the first URL a new user is
 * handed opens on a browser error. Pure, so the promise and the address it is
 * about are decided in one place both steps read.
 */

import type { Port } from "../form-fields/ports-field";
import type { DomainRow } from "../stack-domains";
import type { PublicHostPreview } from "../use-public-host-preview";

import { domainsFromPorts } from "../to-manifest";

/** The generated host this service will publish at, when that host can only
 *  be served self-signed. Null when nothing publishes at the generated host
 *  (internal only, or every public port has its own hostname) or when the
 *  generated host can hold a trusted certificate. */
export function selfSignedGeneratedHost(
  ports: Port[],
  preview: PublicHostPreview | null,
): string | null {
  if (!preview || preview.publicCertEligible) return null;
  const hosts = domainsFromPorts(ports, preview.fqdn) ?? [];
  return hosts.some((h) => h.domain === preview.fqdn) ? preview.fqdn : null;
}

/** The TLS row of the Edge proxy box. */
export function tlsEdgeRow(selfSignedHost: string | null): { label: string; sub: string } {
  if (selfSignedHost) {
    return {
      label: "TLS certificates",
      sub: `Self-signed for ${selfSignedHost}, so browsers will warn. A custom domain pointed at this server gets a trusted Let's Encrypt certificate automatically.`,
    };
  }
  return {
    label: "TLS certificates",
    sub: "Let's Encrypt for hostnames that point at this server · issued and renewed automatically",
  };
}

/**
 * The compose/template wizard's version of {@link selfSignedGeneratedHost}:
 * which of the stack's published hostnames will go out self-signed.
 *
 * The front door is seeded with the generated host the server previewed for
 * the front service; every row the operator has not typed into is a flat
 * sibling of it, under the same generated zone. So while the front door still
 * carries that host and the server says no CA signs it, the front door and
 * every derived row are self-signed. A row the operator typed is their own
 * domain and is not claimed. Rows come front-door-first, as `file.exposed`.
 */
export function selfSignedStackHosts(
  rows: readonly DomainRow[],
  exposed: ReadonlySet<string>,
  preview: PublicHostPreview | null,
): string[] {
  if (!preview || preview.publicCertEligible) return [];
  const front = rows[0];
  if (!front || front.domain.trim().toLowerCase() !== preview.fqdn) return [];
  return rows
    .filter((r, i) => exposed.has(r.key) && r.domain.trim() !== "" && (i === 0 || !r.custom))
    .map((r) => r.domain.trim());
}
