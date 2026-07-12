/**
 * Inbound-endpoint request guards — pure logic, no I/O, unit-tested in
 * __tests__/inbound-guard.test.ts.
 *
 *   - IP allowlist: exact IPv4/IPv6 match + IPv4 CIDR ranges. An empty list
 *     allows any source (the HMAC signature is always required regardless).
 *   - Rate limiter: fixed-size sliding window per key, in-memory. Light by
 *     design — it protects the control plane from a misconfigured CI loop,
 *     not from a determined attacker (that's the firewall's job).
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Parse a dotted-quad IPv4 into a uint32, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const m = IPV4_RE.exec(ip.trim());
  if (!m) return null;
  let out = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    out = out * 256 + octet;
  }
  return out;
}

/** Lowercase + strip an IPv4-mapped IPv6 prefix so "::ffff:1.2.3.4" matches
 * an allowlisted "1.2.3.4". */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  return trimmed.startsWith("::ffff:") && IPV4_RE.test(trimmed.slice(7))
    ? trimmed.slice(7)
    : trimmed;
}

/** True when `entry` is a valid allowlist item: IPv4, IPv4 CIDR, or a
 * plausible IPv6 literal (colon-hex; matched exactly, no v6 CIDR support). */
export function isValidAllowlistEntry(entry: string): boolean {
  const value = entry.trim();
  if (!value) return false;
  const [ip, prefix, rest] = value.split("/");
  if (rest !== undefined) return false;
  if (prefix !== undefined) {
    if (!/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) return false;
    return ipv4ToInt(ip ?? "") !== null;
  }
  if (ipv4ToInt(value) !== null) return true;
  // IPv6: exact-match entries only. Loose shape check (hex groups + colons).
  return /^[0-9a-f:]+$/i.test(value) && value.includes(":");
}

/** Does `ip` match a single allowlist entry (exact IP or IPv4 CIDR)? */
function matchesEntry(ip: string, entry: string): boolean {
  const normalizedEntry = normalizeIp(entry);
  if (ip === normalizedEntry) return true;
  const [range, prefixStr] = normalizedEntry.split("/");
  if (prefixStr === undefined) return false;
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range ?? "");
  if (ipInt === null || rangeInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
    return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (rangeInt & mask) >>> 0;
}

/**
 * Allowlist decision. Empty allowlist → any source. Unknown caller IP (no
 * XFF, no socket address) fails closed when a list is configured.
 */
export function isIpAllowed(ip: string | null, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  const normalized = normalizeIp(ip);
  return allowlist.some((entry) => matchesEntry(normalized, entry));
}

export interface RateLimiter {
  /** True → allowed; false → over the limit for this window. */
  allow(key: string): boolean;
}

/**
 * Sliding-window limiter: at most `limit` hits per `windowMs` per key.
 * `now` is injectable for tests. Old keys are pruned opportunistically so the
 * map can't grow unbounded across many dead tokens.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const t = now();
      const cutoff = t - opts.windowMs;
      // Opportunistic prune of other keys' expired windows (cheap: only when
      // the map is getting large).
      if (hits.size > 512) {
        for (const [k, v] of hits) {
          if ((v[v.length - 1] ?? 0) <= cutoff) hits.delete(k);
        }
      }
      const bucket = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
      if (bucket.length >= opts.limit) {
        hits.set(key, bucket);
        return false;
      }
      bucket.push(t);
      hits.set(key, bucket);
      return true;
    },
  };
}
