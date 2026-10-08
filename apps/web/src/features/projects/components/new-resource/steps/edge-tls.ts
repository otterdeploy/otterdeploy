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
