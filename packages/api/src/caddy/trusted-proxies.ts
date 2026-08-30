/**
 * Teaching the edge which hop in front of it is allowed to name the visitor.
 *
 * Caddy attributes a request to its TCP peer unless told otherwise, so behind
 * a CDN every access-log line reads as the CDN. That is not a cosmetic
 * problem: the Firewall's flagged IPs, its ban targets and its geo column are
 * all built from that field, so a mass block on a Cloudflare-fronted install
 * bans Cloudflare's own edge — which is to say every visitor through those
 * POPs, the operator included.
 *
 * The fix is one global `servers { … }` stanza. `trusted_proxies static`
 * declares the hops whose forwarding headers may be believed; `client_ip_headers`
 * says which header to read. Both are required: a `client_ip_headers` without a
 * trusted-proxy list would let any direct caller claim any address, which is a
 * worse bug than the one being fixed.
 *
 * Nothing is emitted when the operator hasn't declared anything, so a direct
 * install keeps Caddy's default (peer address, header ignored) and cannot be
 * spoofed by a header it was never told to trust.
 */

/** Header order Caddy consults for the client address, most specific first.
 *
 *  `Cf-Connecting-Ip` before `X-Forwarded-For` because Cloudflare sets both
 *  and only the former is a single address it vouches for: XFF behind a chain
 *  of proxies is a list whose left end is client-controlled. Caddy takes the
 *  first header present, so a non-Cloudflare proxy simply falls through to the
 *  standard one. */
const CLIENT_IP_HEADERS = ["Cf-Connecting-Ip", "X-Forwarded-For"] as const;

/**
 * Split an operator's list into entries. Accepts commas, whitespace and
 * newlines interchangeably, because this arrives from a textarea and nobody
 * should have to know which separator we chose.
 */
export function parseTrustedProxyList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * A CIDR or bare address, and nothing that could break out of the directive.
 *
 * Deliberately strict rather than clever: this string is written verbatim into
 * a Caddyfile, so the charset is the boundary. Anything that isn't hex digits,
 * dots, colons and an optional prefix length is rejected outright rather than
 * escaped.
 */
export function isTrustedProxyEntry(entry: string): boolean {
  return /^[0-9a-fA-F.:]+(\/\d{1,3})?$/.test(entry);
}

/**
 * The `servers { … }` lines for the global block, or none.
 *
 * Invalid entries are dropped rather than failing the render: a typo in this
 * field must not take the whole edge config down with it, and a dropped entry
 * just means that hop isn't trusted — the safe direction. An all-invalid list
 * emits nothing at all, which is the same as not configuring it.
 */
export function trustedProxyLines(raw: string | null | undefined, indent = "\t"): string[] {
  if (!raw) return [];
  const entries = parseTrustedProxyList(raw).filter(isTrustedProxyEntry);
  if (entries.length === 0) return [];
  return [
    `${indent}servers {`,
    `${indent}\ttrusted_proxies static ${entries.join(" ")}`,
    `${indent}\tclient_ip_headers ${CLIENT_IP_HEADERS.join(" ")}`,
    `${indent}}`,
  ];
}
