/**
 * Trusted-proxy resolution for X-Forwarded-For / X-Forwarded-Proto.
 *
 * The control plane sits behind Caddy in production (and, sometimes, plain
 * loopback/SSH-tunnel access during bootstrap). Both paths speak to the Hono
 * app directly — Caddy as a reverse proxy, a tunnel as a raw TCP forward — so
 * the app is the only place that can tell whether the headers a request
 * carries were actually SET by something we trust. Blindly trusting
 * `X-Forwarded-For`/`X-Forwarded-Proto` lets any direct caller (an internet
 * client hitting the control plane directly, or — if the control plane's
 * port were ever reachable from a project network — a tenant workload) spoof
 * its IP and scheme, defeating rate limits, IP allowlists, the firewall/
 * blocklist (od-5j8.5), and audit-log attribution (od-5j8.10).
 *
 * The fix: only honor forwarding headers when the IMMEDIATE TCP peer matches
 * `env.TRUSTED_PROXIES` (comma-separated bare IPs and/or CIDRs, default
 * loopback-only). Every consumer that needs the caller's real IP/proto
 * should call {@link resolveClient} (or the pure {@link resolveClientAddress}
 * in tests) instead of reading the headers directly.
 */
import type { Context } from "hono";

import { env } from "@otterdeploy/env/server";
import { getConnInfo } from "hono/bun";
import { BlockList, isIP } from "node:net";

export interface ResolvedClientAddress {
  /** The caller's real IP: the X-Forwarded-For first hop when the peer is
   *  trusted, otherwise the raw TCP peer address. Never client-controlled
   *  when `trustedPeer` is false. */
  ip: string;
  /** "https" only when a trusted peer forwarded it; otherwise "http" — never
   *  taken from a header an untrusted caller could set. */
  proto: "http" | "https";
  /** Whether the immediate peer matched the trusted-proxy list. False means
   *  `ip`/`proto` came from the raw connection, not the headers. */
  trustedPeer: boolean;
}

/** Parses a comma-separated list of bare IPs and/or CIDRs into a BlockList.
 *  Garbage entries (hostnames, malformed CIDRs) are silently skipped — same
 *  fail-open-on-typo, fail-closed-on-trust posture as the egress allowlist
 *  parser (packages/shared/src/egress-policy.ts): a malformed entry must
 *  never crash the request path, and an ENTRY that fails to parse simply
 *  isn't trusted (it can't accidentally trust "everything"). */
function parseTrustedProxies(raw: string): BlockList {
  const list = new BlockList();
  for (const entryRaw of raw.split(",")) {
    const entry = entryRaw.trim();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    const address = slash === -1 ? entry : entry.slice(0, slash);
    const family = isIP(address);
    if (family === 0) continue;
    const type = family === 4 ? "ipv4" : "ipv6";
    if (slash === -1) {
      list.addAddress(address, type);
      continue;
    }
    const prefix = Number(entry.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) continue;
    list.addSubnet(address, prefix, type);
  }
  return list;
}

// Parsing a BlockList is cheap but there's no reason to redo it per request;
// cache the parse keyed by the raw string (changes only on env reload/test
// override).
let cached: { raw: string; list: BlockList } | null = null;
function trustedProxyList(raw: string): BlockList {
  if (cached?.raw !== raw) cached = { raw, list: parseTrustedProxies(raw) };
  return cached.list;
}

/** True when `peerAddress` (the actual TCP peer — never a header) matches
 *  the configured trusted-proxy list. */
export function isTrustedProxyPeer(peerAddress: string | null, trustedProxiesRaw: string): boolean {
  if (!peerAddress) return false;
  const family = isIP(peerAddress);
  if (family === 0) return false;
  return trustedProxyList(trustedProxiesRaw).check(peerAddress, family === 4 ? "ipv4" : "ipv6");
}

export interface ResolveClientAddressInput {
  /** The actual TCP peer address (e.g. from Bun's `requestIP`/`getConnInfo`)
   *  — never derived from a header. Null when unavailable (e.g. a transport
   *  that doesn't expose it), which is treated as untrusted. */
  peerAddress: string | null;
  headers: Headers;
  trustedProxiesRaw: string;
}

/** Pure resolution — no Hono/Bun dependency, so it's directly unit testable.
 *  Forwarding headers are honored ONLY when `peerAddress` matches
 *  `trustedProxiesRaw`; otherwise they're ignored outright and the raw
 *  connection is authoritative. */
export function resolveClientAddress(input: ResolveClientAddressInput): ResolvedClientAddress {
  const trustedPeer = isTrustedProxyPeer(input.peerAddress, input.trustedProxiesRaw);
  if (!trustedPeer) {
    return { ip: input.peerAddress ?? "unknown", proto: "http", trustedPeer: false };
  }
  const xff = input.headers.get("x-forwarded-for");
  const forwardedIp = xff?.split(",")[0]?.trim();
  const forwardedProto = input.headers.get("x-forwarded-proto")?.trim().toLowerCase();
  return {
    ip: forwardedIp || input.peerAddress || "unknown",
    proto: forwardedProto === "https" ? "https" : "http",
    trustedPeer: true,
  };
}

/** Best-effort raw TCP peer address for the current request. Bun's
 *  `requestIP` (surfaced via `hono/bun`'s `getConnInfo`) is unavailable for
 *  some transports (e.g. a Unix-socket listener, or the vitest fetch-only
 *  harness) — treated as "no peer", which resolveClientAddress treats as
 *  untrusted (fails closed, never fails open). */
function rawPeerAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/** Hono/Bun adapter — resolves the real client IP/proto for the current
 *  request. Every consumer that used to read `x-forwarded-for` /
 *  `x-forwarded-proto` directly should call this instead (see
 *  apps/server/src/handlers/deploy-protection/shared.tsx and
 *  apps/server/src/handlers/webhooks/inbound.ts). */
export function resolveClient(
  c: Context,
  trustedProxiesRaw: string = env.TRUSTED_PROXIES,
): ResolvedClientAddress {
  return resolveClientAddress({
    peerAddress: rawPeerAddress(c),
    headers: c.req.raw.headers,
    trustedProxiesRaw,
  });
}

/**
 * Strips X-Forwarded-For / X-Forwarded-Proto from the request headers IN
 * PLACE when the immediate peer is not trusted, so downstream code that
 * still reads those headers directly (in particular evlog's `auditEnricher`,
 * which populates `audit.context.ip` straight from
 * `x-forwarded-for`/`x-real-ip` and has no injectable IP resolver) can never
 * see a spoofed value. Call this once, as early as possible in the
 * middleware chain — before the evlog middleware runs. A no-op when the peer
 * IS trusted (the edge's own headers pass through unmodified) or when the
 * request already has no such headers.
 */
export function sanitizeForwardingHeaders(
  c: Context,
  trustedProxiesRaw: string = env.TRUSTED_PROXIES,
): void {
  const trusted = isTrustedProxyPeer(rawPeerAddress(c), trustedProxiesRaw);
  if (trusted) return;
  const headers = c.req.raw.headers;
  headers.delete("x-forwarded-for");
  headers.delete("x-forwarded-proto");
  headers.delete("x-real-ip");
}
