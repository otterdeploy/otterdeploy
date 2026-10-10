/**
 * The shape Settings → Domains reads for the base domain, and the one place
 * the server's address is taken out of it.
 *
 * The owner treats the server IP as sensitive: only an installation admin may
 * see it. Everyone else still gets every state (pointing here, elsewhere, not
 * resolving, unknown) and every record name; the address itself is removed
 * wherever it would appear: the wildcard record's value, the addresses a
 * probe resolved to, and the sslip.io suffix. Redacting one assembled view,
 * rather than at each field as it is built, keeps a newly added field from
 * leaking it by default.
 */

import type { TxtDnsCheck, WildcardDnsCheck } from "../../lib/base-domain-dns";
import type { RequiredDnsRecord } from "../../lib/dns-records";

/** What a newly exposed service gets right now, from the real resolver. */
export interface BaseDomainPublishingView {
  source: "org-base" | "local-base" | "sslip-fallback";
  /** The hostname after `<service>-<project>.`. With `onServerIp`, it follows
   *  the server's address (`<ip>.sslip.io`), which is never in this string. */
  suffix: string;
  onServerIp: boolean;
  certificate: "lets-encrypt" | "self-signed";
}

export type PointingView = Omit<WildcardDnsCheck, "reachability">;

export interface BaseDomainDnsView {
  baseDomain: string | null;
  /** Install admins only; null for everyone else, and when unknown. */
  serverIp: string | null;
  /** An address exists but this caller may not see it. */
  serverIpHidden: boolean;
  publishing: BaseDomainPublishingView;
  /** Zone apex and provider, from the nameservers. */
  zone: string | null;
  provider: "cloudflare" | "unknown";
  /** The two records the base domain needs. A null value is redacted. */
  records: (Omit<RequiredDnsRecord, "value"> & {
    value: string | null;
    purpose: "wildcard" | "verify";
  })[];
  wildcard: PointingView | null;
  /** Where the bare domain points. Services don't need it; shown so an apex
   *  serving another site reads as expected rather than as a fault. */
  apex: PointingView | null;
  txt: TxtDnsCheck | null;
}

export function toPointingView(check: WildcardDnsCheck): PointingView {
  return {
    probe: check.probe,
    state: check.state,
    addresses: check.addresses,
    proxied: check.proxied,
  };
}

export function redactServerIp(
  view: BaseDomainDnsView,
  ips: { serverIp: string | null; serverIpv6: string | null },
  reveal: boolean,
): BaseDomainDnsView {
  if (reveal) return view;
  const own = new Set([ips.serverIp, ips.serverIpv6].filter((ip) => ip !== null));
  const strip = (pointing: PointingView | null): PointingView | null =>
    pointing && { ...pointing, addresses: pointing.addresses.filter((a) => !own.has(a)) };
  return {
    ...view,
    serverIp: null,
    serverIpHidden: own.size > 0,
    records: view.records.map((r) => (r.type === "A" ? { ...r, value: null } : r)),
    wildcard: strip(view.wildcard),
    apex: strip(view.apex),
  };
}
