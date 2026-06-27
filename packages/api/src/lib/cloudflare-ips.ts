/**
 * Cloudflare edge IP ranges + a CIDR membership test, used to recognise a
 * custom domain that's proxied through Cloudflare (orange-cloud).
 *
 * A proxied domain's A/AAAA resolves into one of these ranges rather than
 * our origin IP — Cloudflare terminates TLS at its edge, so the origin
 * can't complete an ACME challenge and should serve `tls internal`
 * instead (Cloudflare "Full" SSL mode accepts it). Coolify keeps the same
 * IPv4 list for its DNS-validation check; we add the published IPv6 ranges
 * and match both via BigInt so an AAAA record is classified too.
 *
 * Source: https://www.cloudflare.com/ips/ (stable; rarely changes).
 */

const CLOUDFLARE_CIDRS = [
  // IPv4
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  // IPv6
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/** Parse an IPv4 or IPv6 literal into a BigInt, or null if unparseable. */
function ipToBigInt(ip: string): bigint | null {
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let value = 0n;
    for (const part of parts) {
      const octet = Number(part);
      if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
      value = (value << 8n) | BigInt(octet);
    }
    return value;
  }
  return ipv6ToBigInt(ip);
}

/** Expand a (possibly `::`-compressed) IPv6 literal to a 128-bit BigInt. */
function ipv6ToBigInt(ip: string): bigint | null {
  // Drop a zone id if present (fe80::1%en0) — irrelevant for range checks.
  const [bare = ""] = ip.split("%");
  const halves = bare.split("::");
  if (halves.length > 2) return null;

  const first = halves[0];
  const second = halves[1];
  const head = first ? first.split(":") : [];
  const tail = halves.length === 2 && second ? second.split(":") : [];
  const missing = 8 - (head.length + tail.length);
  if (missing < 0 || (halves.length === 1 && head.length !== 8)) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function inCidr(ip: string, cidr: string): boolean {
  const [network, bitsStr] = cidr.split("/");
  if (network == null) return false;
  const bits = Number(bitsStr);
  const ipVal = ipToBigInt(ip);
  const netVal = ipToBigInt(network);
  if (ipVal == null || netVal == null) return false;

  const isV6 = cidr.includes(":");
  const totalBits = isV6 ? 128 : 32;
  // A /0 (mask all) would shift by totalBits — guard it.
  if (bits <= 0) return true;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(totalBits - bits);
  return (ipVal & mask) === (netVal & mask);
}

/** True when the address sits in any published Cloudflare edge range. */
export function isCloudflareIp(ip: string): boolean {
  const isV6 = ip.includes(":");
  return CLOUDFLARE_CIDRS.some((cidr) => cidr.includes(":") === isV6 && inCidr(ip, cidr));
}
