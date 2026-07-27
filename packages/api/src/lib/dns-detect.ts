/**
 * Who runs DNS for a domain, and is it proxying us?
 *
 * Two questions the "add a domain" flow needs before it can be helpful:
 *
 *   1. WHICH PROVIDER. If it's Cloudflare we can offer one-click DNS setup
 *      instead of making someone copy records by hand — the single biggest
 *      source of "my domain doesn't work" (docs/gap-audit-railway-networking.md
 *      §3). Detection is deliberately separate from whether we hold a token:
 *      knowing it's Cloudflare is what lets us say "connect your account" to
 *      someone who hasn't yet, rather than silently showing manual records.
 *
 *   2. IS IT PROXIED. A Cloudflare record with the orange cloud on terminates
 *      TLS at Cloudflare and forwards to us, which breaks ACME HTTP-01 and can
 *      leave a domain stuck mid-issuance with no explanation (§5, and the
 *      real-world cert that sat at `unknown`). Worth warning about, because the
 *      symptom points nowhere near the cause.
 */

import { resolveAddressesRobust, resolveNsRobust } from "./dns-resolver";

export type DnsProvider = "cloudflare" | "unknown";

/**
 * Nameserver suffixes we can act on. Only Cloudflare for now — the one we have
 * an API client for. A provider we can merely NAME buys the operator nothing,
 * so this list stays tied to what we can actually automate.
 */
const PROVIDER_NS_SUFFIXES: ReadonlyArray<{ provider: DnsProvider; suffix: string }> = [
  { provider: "cloudflare", suffix: "ns.cloudflare.com" },
];

export interface DnsProviderInfo {
  provider: DnsProvider;
  /** The zone apex that actually answered NS — what a Cloudflare zone is keyed
   *  on, and what the UI should name ("add these records to acme.com"). */
  zone: string | null;
  nameservers: string[];
  /** Set when the lookup itself failed, as opposed to succeeding with an
   *  unrecognised provider. The UI must not claim "not Cloudflare" when the
   *  truth is "we couldn't ask". */
  lookupFailed: boolean;
}

/**
 * Candidate zone apexes for `domain`, longest first.
 *
 * `a.b.acme.co.uk` → `a.b.acme.co.uk`, `b.acme.co.uk`, `acme.co.uk`, `co.uk`.
 * Deliberately not a public-suffix-list parse: we are not deciding what is
 * registrable, we are finding the label that answers NS, and asking in
 * longest-first order means a delegated subzone is found before its parent —
 * which is the correct answer when someone has delegated `dev.acme.com`
 * separately.
 *
 * Stops at two labels: a single label is a TLD, and querying it wastes a
 * round trip to learn nothing we can use.
 */
export function zoneCandidates(domain: string): string[] {
  const labels = domain.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 2 <= labels.length; i++) out.push(labels.slice(i).join("."));
  return out;
}

/** Match a nameserver set against the providers we can automate. */
export function providerFromNameservers(nameservers: readonly string[]): DnsProvider {
  for (const ns of nameservers) {
    const host = ns.toLowerCase();
    for (const { provider, suffix } of PROVIDER_NS_SUFFIXES) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return provider;
    }
  }
  return "unknown";
}

/**
 * Walk up from `domain` until something answers NS, then name the provider.
 *
 * A miss at one level is not a failure — `waves.acme.com` legitimately has no
 * NS of its own — so only a total absence of answers counts as a failed lookup.
 */
export async function detectDnsProvider(domain: string): Promise<DnsProviderInfo> {
  const candidates = zoneCandidates(domain);
  let sawTransportError = false;

  for (const candidate of candidates) {
    try {
      const nameservers = await resolveNsRobust(candidate);
      if (nameservers.length === 0) continue;
      return {
        provider: providerFromNameservers(nameservers),
        zone: candidate,
        nameservers,
        lookupFailed: false,
      };
    } catch {
      // Expected for every level below the apex. Remembered rather than
      // returned so that "no level answered" can be reported honestly.
      sawTransportError = true;
    }
  }

  return {
    provider: "unknown",
    zone: null,
    nameservers: [],
    lookupFailed: sawTransportError,
  };
}

/**
 * Is this hostname being proxied rather than pointed straight at us?
 *
 * Decided by comparing the resolved addresses against the origin we expect
 * instead of by matching Cloudflare's published IP ranges. That is both simpler
 * and more accurate for the question actually being asked: we do not care
 * whether an address belongs to Cloudflare, we care whether traffic reaches
 * THIS install. A record pointing anywhere other than our origin behaves the
 * same way regardless of who owns the address, and there is no IP-range list to
 * keep in sync.
 *
 * `null` means "cannot tell" — no addresses resolved yet, or no expected origin
 * configured. Callers must not render that as "not proxied".
 */
export async function detectProxied(input: {
  domain: string;
  expectedOrigin: string | null;
}): Promise<{ proxied: boolean | null; resolved: string[] }> {
  if (!input.expectedOrigin) return { proxied: null, resolved: [] };

  const resolved = await resolveAddressesRobust(input.domain).catch(() => [] as string[]);
  if (resolved.length === 0) return { proxied: null, resolved };

  return { proxied: !resolved.includes(input.expectedOrigin), resolved };
}
