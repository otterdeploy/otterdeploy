/**
 * DNS lookups that prefer public resolvers over the host's system
 * resolver.
 *
 * Self-hosted boxes (and dev machines) routinely sit behind a
 * split-horizon / caching local resolver that lags propagation or returns
 * ENODATA for a record that's already live on the public internet — the
 * record resolves fine on 1.1.1.1 / 8.8.8.8. Coolify hits configurable DNS
 * servers for exactly this reason. We query public resolvers first and
 * fall back to the system resolver only when the public ones are
 * *unreachable* (air-gapped install, port-53 egress blocked) — a
 * definitive "not there" from a public resolver (ENODATA/ENOTFOUND/NXDOMAIN)
 * is trusted as-is and not masked by the fallback.
 */

import { promises as dns } from "node:dns";

const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

const DEFINITIVE_MISS = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);

// The lookups we use, satisfied by both a configured `dns.Resolver` and the
// `dns` promises namespace (the system-resolver fallback).
type ResolverLike = Pick<dns.Resolver, "resolveTxt" | "resolve4" | "resolve6">;

/** Run `query` against a public-resolver-backed resolver, falling back to
 *  the system resolver only on transport-level failure. */
async function withPublicResolver<T>(query: (resolver: ResolverLike) => Promise<T>): Promise<T> {
  try {
    // dns.Resolver here is the promise-based resolver (node:dns `promises`
    // namespace) — its methods return Promises, unlike the top-level
    // callback Resolver.
    const resolver = new dns.Resolver();
    resolver.setServers(PUBLIC_RESOLVERS);
    return await query(resolver);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && DEFINITIVE_MISS.has(code)) throw err;
    return query(dns);
  }
}

/** TXT lookup; returns each record's chunks joined into one string. */
export async function resolveTxtRobust(name: string): Promise<string[]> {
  const raw = await withPublicResolver((r) => r.resolveTxt(name));
  return raw.map((chunks) => chunks.join(""));
}

/** A + AAAA lookup, merged. Each family's NODATA collapses to "no address
 *  of that family" rather than failing the whole lookup, so an A-only
 *  domain still returns its IPv4. */
export async function resolveAddressesRobust(name: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    withPublicResolver((r) => r.resolve4(name)).catch(() => [] as string[]),
    withPublicResolver((r) => r.resolve6(name)).catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}
