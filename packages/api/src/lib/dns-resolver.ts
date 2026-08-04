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
 *
 * That distinction — "authoritatively absent" vs "couldn't ask" — is the whole
 * point of this module, and it's what the two error types below encode. Every
 * caller has to branch on it (an absent record means "not pointed at us"; an
 * unreachable resolver means "we don't know"), and when this module threw raw
 * node errors each caller re-sniffed `err.code` against its own copy of the
 * ENODATA/ENOTFOUND/NXDOMAIN list to recover it. Returning a `Result` with
 * tagged errors keeps that classification in one place.
 */

import { Result, TaggedError } from "better-result";
import { promises as dns } from "node:dns";

const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

const DEFINITIVE_MISS = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);

/**
 * The name resolves, but has no record of the requested type — an
 * authoritative answer, not a failure to ask. Trustworthy: callers may render
 * this as "not configured" / "not pointed here".
 */
export class DnsRecordMissing extends TaggedError("DnsRecordMissing")<{
  name: string;
  /** The node error code that classified this: ENODATA, ENOTFOUND or NXDOMAIN. */
  code: string;
  cause: unknown;
}>() {}

/**
 * Neither the public resolvers nor the system resolver could answer —
 * timeout, refused, no egress on port 53. Says nothing about whether the
 * record exists, so callers must degrade to "unknown" rather than "missing".
 */
export class DnsLookupFailed extends TaggedError("DnsLookupFailed")<{
  name: string;
  cause: unknown;
}>() {}

export type DnsError = DnsRecordMissing | DnsLookupFailed;

/** The single place `err.code` is interpreted. */
function classify(name: string, cause: unknown): DnsError {
  const code = (cause as { code?: string }).code;
  return code !== undefined && DEFINITIVE_MISS.has(code)
    ? new DnsRecordMissing({ name, code, cause })
    : new DnsLookupFailed({ name, cause });
}

// The lookups we use, satisfied by both a configured `dns.Resolver` and the
// `dns` promises namespace (the system-resolver fallback).
type ResolverLike = Pick<dns.Resolver, "resolveTxt" | "resolve4" | "resolve6" | "resolveNs">;

/** Run `query` against a public-resolver-backed resolver, falling back to
 *  the system resolver only on transport-level failure. */
async function withPublicResolver<T>(
  name: string,
  query: (resolver: ResolverLike) => Promise<T>,
): Promise<Result<T, DnsError>> {
  // dns.Resolver here is the promise-based resolver (node:dns `promises`
  // namespace) — its methods return Promises, unlike the top-level
  // callback Resolver.
  const resolver = new dns.Resolver();
  resolver.setServers(PUBLIC_RESOLVERS);

  const viaPublic = await Result.tryPromise({
    try: () => query(resolver),
    catch: (cause) => classify(name, cause),
  });
  if (viaPublic.isOk()) return viaPublic;
  // A definitive miss from a public resolver IS the answer — falling back to
  // the system resolver here is what would let a split-horizon box overwrite
  // the public truth with its own stale view.
  if (DnsRecordMissing.is(viaPublic.error)) return viaPublic;

  return Result.tryPromise({
    try: () => query(dns),
    catch: (cause) => classify(name, cause),
  });
}

/** TXT lookup; returns each record's chunks joined into one string. */
export async function resolveTxtRobust(name: string): Promise<Result<string[], DnsError>> {
  const raw = await withPublicResolver(name, (r) => r.resolveTxt(name));
  return raw.map((records) => records.map((chunks) => chunks.join("")));
}

/**
 * NS lookup, lowercased and trailing-dot-stripped.
 *
 * Only a zone apex answers NS, so callers asking about `waves.acme.com` have
 * to walk up to `acme.com` — see `detectDnsProvider` in ./dns-detect.ts, which
 * owns that walk. A level below the apex yields `DnsRecordMissing`, which that
 * walk treats as "keep climbing" rather than as a failure.
 */
export async function resolveNsRobust(name: string): Promise<Result<string[], DnsError>> {
  const raw = await withPublicResolver(name, (r) => r.resolveNs(name));
  return raw.map((records) => records.map((ns) => ns.toLowerCase().replace(/\.$/, "")));
}

/**
 * A + AAAA lookup, merged. Each family's miss collapses to "no address of that
 * family" rather than failing the whole lookup, so an A-only domain still
 * returns its IPv4 — only a both-families failure is an error.
 *
 * When both fail, a transport failure wins over a definitive miss: if we
 * couldn't reach a resolver for either family, "no addresses" is not something
 * we actually established.
 */
export async function resolveAddressesRobust(name: string): Promise<Result<string[], DnsError>> {
  const [v4, v6] = await Promise.all([
    withPublicResolver(name, (r) => r.resolve4(name)),
    withPublicResolver(name, (r) => r.resolve6(name)),
  ]);

  if (v4.isErr() && v6.isErr()) {
    return DnsRecordMissing.is(v4.error) ? v6 : v4;
  }
  return Result.ok([...(v4.isOk() ? v4.value : []), ...(v6.isOk() ? v6.value : [])]);
}
