/**
 * The DNS records a domain needs to work here — derived in one place, for every
 * surface that asks for a domain.
 *
 * Service custom domains, the control-plane FQDN and the workspace base domain
 * all turned out to need the identical pair: an address record pointing at this
 * install, and the ownership TXT that gates cert issuance. They had each grown
 * their own copy of that knowledge, phrased differently in the UI, which is why
 * "add a domain" felt like three unrelated features.
 *
 * These are always SERVER-derived. The DNS-writing endpoint takes a target
 * (which service, the control plane, …) and never a caller-supplied record set:
 * accepting arbitrary records would turn a connected Cloudflare token into an
 * API for writing anything into the operator's zone.
 */

import { VERIFY_TXT_PREFIX } from "./dns-verify";

export interface RequiredDnsRecord {
  type: "A" | "TXT";
  /** Fully-qualified record name. */
  name: string;
  value: string;
  /**
   * `name` with the zone suffix removed — "waves" rather than
   * "waves.acme.com", and "@" at the apex. Every DNS UI (Cloudflare's
   * included) wants the zone-relative form, and pasting the FQDN into them
   * silently creates `waves.acme.com.acme.com`. Null when the zone isn't known
   * yet, so the UI can fall back to the FQDN rather than invent one.
   */
  relativeName: string | null;
}

/** Strip a zone suffix to get the record name a DNS provider's UI expects. */
export function toRelativeName(fqdn: string, zone: string | null): string | null {
  if (!zone) return null;
  const name = fqdn.toLowerCase().replace(/\.$/, "");
  const z = zone.toLowerCase().replace(/\.$/, "");
  if (name === z) return "@";
  return name.endsWith(`.${z}`) ? name.slice(0, -(z.length + 1)) : null;
}

/**
 * What the operator must publish for `domain` to serve traffic here.
 *
 * The TXT proves intent, which an A record cannot: an address might already
 * point at this install for unrelated reasons (shared IP, a CDN), and that must
 * not by itself grant the right to publish on that name — see ./dns-verify.ts.
 */
export function requiredDnsRecords(input: {
  domain: string;
  serverIp: string | null;
  verifyToken: string | null;
  /** Zone apex from detection, used only to compute `relativeName`. */
  zone?: string | null;
}): RequiredDnsRecord[] {
  const zone = input.zone ?? null;
  const records: RequiredDnsRecord[] = [];

  if (input.serverIp) {
    records.push({
      type: "A",
      name: input.domain,
      value: input.serverIp,
      relativeName: toRelativeName(input.domain, zone),
    });
  }

  if (input.verifyToken) {
    const txtName = `${VERIFY_TXT_PREFIX}.${input.domain}`;
    records.push({
      type: "TXT",
      name: txtName,
      value: input.verifyToken,
      relativeName: toRelativeName(txtName, zone),
    });
  }

  return records;
}
