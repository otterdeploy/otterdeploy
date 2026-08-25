/**
 * Domain rules for the Service primitive: what counts as an acceptable custom
 * host, whether ACME can issue for it, and how a `proxy_route` row is projected
 * onto the wire shape the dashboard reads.
 *
 * Split out of `domains.ts` so that file stays about the operations (add,
 * update, recheck, remove) rather than the predicates they all lean on.
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { stripToHostname } from "@otterdeploy/shared/public-host";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import type { ProxyRouteRecord } from "../../caddy/queries";
import type { DnsState } from "../../lib/domain-reachability";
import type { DomainSources } from "../../lib/domains";
import type { ResourceRef } from "./inputs";

import { VERIFY_TXT_PREFIX } from "../../lib/dns-verify";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";

export interface ServiceDomainView {
  id: string;
  // Scoping ids so the web client's on-demand collection can filter subsets by
  // (project, resource): mirrors the deployment-task view.
  projectId: string;
  resourceId: string;
  domain: string;
  /** Container port this host proxies to (proxy_route.upstreamPort). */
  port: number;
  source: "generated" | "custom";
  isPrimary: boolean;
  /** live = rendered into Caddy now; disabled = the system gate (service
   *  unexposed / verification pending); paused = the operator's explicit
   *  off switch, with all configuration kept intact. */
  status: "live" | "disabled" | "paused";
  /** Where the host currently resolves (custom hosts). */
  dnsState: DnsState;
  dnsCheckedAt: string | null;
  /** TLS cert lifecycle, promoted from Caddy ACME events (edge-logs). */
  certState: "unknown" | "obtaining" | "valid" | "failed";
  certError: string | null;
  certCheckedAt: string | null;
  usesAcme: boolean;
  protected: boolean;
  ownershipVerified: boolean;
  verifyRecord: string | null;
  verifyToken: string | null;
  /** The IP to point an A record at (our server). Null when unknown (dev). */
  dnsTarget: string | null;
}

/** Status projection, split out so the pause/system-gate precedence is a
 *  pure decision the tests can pin: the operator's pause wins over both
 *  system states: a paused route must not masquerade as merely "disabled"
 *  (which the UI treats as "fix your DNS / re-expose"). */
export function domainStatusFor(route: Pick<ProxyRouteRecord, "enabled" | "disabledByUser">) {
  if (route.disabledByUser) return "paused" as const;
  return route.enabled ? ("live" as const) : ("disabled" as const);
}

export function toDomainView(route: ProxyRouteRecord, dnsTarget: string | null): ServiceDomainView {
  return {
    id: route.id,
    projectId: route.projectId,
    // Service-domain routes are always tied to a resource (proxyRoute.resourceId
    // is nullable in general but never null for these); the fallback is dead in
    // practice and only spares a type assertion.
    resourceId: route.resourceId ?? "",
    domain: route.domain,
    port: route.upstreamPort,
    source: route.source,
    isPrimary: route.isPrimary,
    status: domainStatusFor(route),
    dnsState: route.dnsState,
    dnsCheckedAt: route.dnsCheckedAt ? route.dnsCheckedAt.toISOString() : null,
    certState: route.certState,
    certError: route.certError,
    certCheckedAt: route.certCheckedAt ? route.certCheckedAt.toISOString() : null,
    usesAcme: route.usesAcme,
    protected: route.protected,
    ownershipVerified: route.source === "generated" || route.domainVerifiedAt !== null,
    verifyRecord: route.source === "custom" ? `${VERIFY_TXT_PREFIX}.${route.domain}` : null,
    verifyToken: route.source === "custom" ? route.domainVerifyToken : null,
    dnsTarget,
  };
}

// ---------------------------------------------------------------------------
// Validation + cert decision
// ---------------------------------------------------------------------------

// Lowercase FQDN: one or more dot-separated labels. Allows a single-label
// dev TLD (`app.localhost`) and normal multi-label public names. Rejects
// schemes, paths, ports, and wildcards: those are caller errors, not hosts.
const FQDN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCALHOST_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/;
const RESERVED_CUSTOM_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "home.arpa",
  "test",
  "invalid",
  "example",
];

export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/\.$/, "");
  if (!FQDN_RE.test(d) && !LOCALHOST_RE.test(d)) return null;
  if (RESERVED_CUSTOM_SUFFIXES.some((suffix) => d === suffix || d.endsWith(`.${suffix}`))) {
    return null;
  }
  return d;
}

export async function isReservedControlPlaneDomain(domain: string): Promise<boolean> {
  const [settings] = await db
    .select({ domain: platformSettings.controlPlaneFqdn })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return settings?.domain?.toLowerCase().replace(/\.$/, "") === domain;
}

/**
 * Hosts no public CA will ever sign, whatever DNS says.
 *
 * Distinct from "DNS doesn't currently look right": this is a permanent
 * property of the name, so it outranks the downgrade guard below. There is
 * no certificate here worth protecting.
 */
function canHoldPublicCert(domain: string): boolean {
  return !domain.endsWith(".localhost") && !domain.endsWith(".sslip.io");
}

/** ACME can only issue for a publicly resolvable name that points at us. A
 *  `.localhost`/sslip host can't get a real cert, and a proxied/unpointed
 *  host's challenge can't complete. All stay on `tls internal`. */
export function acmeFor(domain: string, dnsState: DnsState): boolean {
  if (!canHoldPublicCert(domain)) return false;
  return dnsState === "pointed";
}

/**
 * The ACME decision for a host the platform MINTS or RENAMES under one of its
 * own apexes, as opposed to {@link acmeFor}, which judges a custom host on
 * DNS alone.
 *
 * Two ways to qualify. The apex is TXT-verified, so it vouches for every label
 * beneath it; or DNS was measured landing on this server, which is the same
 * control the TXT challenge — and ACME's own HTTP-01 — establishes.
 *
 * The union matters in both directions, which is why neither half alone was
 * right:
 *
 *   - Requiring only `apexVerified` left a host whose DNS already pointed here
 *     on a self-signed cert. The mint path did exactly that while the rename
 *     path accepted DNS proof, so the same host got a different answer
 *     depending on which one last touched it.
 *   - Requiring only `pointed` would drop a verified apex sitting behind
 *     Cloudflare (which reads `proxied`) onto `tls internal` — the downgrade
 *     acme-downgrade.test.ts exists to prevent.
 *
 * Both exclusions outrank both tests. `isLocalBase` is the dev-only wildcard,
 * which never gets a public cert whatever it is named (LOCAL_BASE_DOMAIN is
 * env-configurable and need not end in `.localhost`). `canHoldPublicCert`
 * catches sslip and `.localhost` names, which a mint stamps `pointed` by
 * construction rather than by measurement — so DNS "proof" means nothing for
 * them, and no CA would issue anyway.
 */
export function acmeForPlatformHost(args: {
  domain: string;
  isLocalBase: boolean;
  apexVerified: boolean;
  dnsState: DnsState;
}): boolean {
  if (args.isLocalBase || !canHoldPublicCert(args.domain)) return false;
  return args.apexVerified || provenByDns(args.dnsState);
}

/**
 * The ACME decision for a route that ALREADY EXISTS, as opposed to
 * {@link acmeFor}, which decides for a brand-new one.
 *
 * The difference is the one thing a re-evaluation must never do: take a site
 * that is serving a trusted certificate and put it back on a self-signed one.
 *
 * That is not hypothetical. A generated route is born `dnsState: "pointed"`
 * (see expose.ts) and gets a real certificate. Put Cloudflare's proxy in front
 * of it afterwards (a supported, common, and usually *desirable* topology)
 * and the next recheck reads the Cloudflare anycast addresses, calls the host
 * `proxied`, and `acmeFor` returns false. The route flips to `tls internal`
 * and Caddy replaces a valid Let's Encrypt certificate with a self-signed one,
 * in the same second, with no warning. If the operator's Cloudflare SSL mode
 * is Full (strict), their site goes down.
 *
 * So a downgrade needs more than a DNS heuristic disagreeing with the past: it
 * needs evidence the certificate is not working. `certState === "valid"` is
 * exactly that evidence, promoted from Caddy's own log plane. The edge is
 * telling us it holds a good certificate. Upgrades are unaffected; only the
 * valid → self-signed direction is refused.
 */
export function acmeForExistingRoute(args: {
  domain: string;
  dnsState: DnsState;
  currentUsesAcme: boolean;
  certState: "unknown" | "obtaining" | "valid" | "failed";
}): boolean {
  // Checked before the guard, not through acmeFor: a name that can never hold
  // a public certificate has none to protect, so the guard must not resurrect
  // ACME for it on the strength of stale flags.
  if (!canHoldPublicCert(args.domain)) return false;
  if (acmeFor(args.domain, args.dnsState)) return true;
  // Refuse the downgrade while the edge reports a working certificate.
  return args.currentUsesAcme && args.certState === "valid";
}

export async function serverIpFor(ref: ResourceRef): Promise<string | null> {
  const sources = await loadDomainSourcesForProject(ref.projectId);
  return sources?.serverIp ?? null;
}

/**
 * Is this host a subdomain of an apex the platform already vouches for (the
 * project's custom domain or the org base domain)?
 *
 * Renaming a generated host WITHIN such an apex must stay in the generated
 * trust model: the apex has its own ownership flow (org/project TXT
 * verification) and one wildcard record covers every label under it, so
 * demanding a per-route TXT proof for `netbird.<base>` after the platform
 * itself minted `netbird-shared.<base>` is a verification of something
 * already established. That demand is also what made an edited generated
 * domain silently go dark: the rename flipped the route to an unverified
 * custom host, disabled it, and the edit read as "didn't apply".
 */
export function platformApexFor(
  domain: string,
  sources: Pick<
    DomainSources,
    | "projectCustomDomain"
    | "projectCustomDomainVerifiedAt"
    | "orgBaseDomain"
    | "orgBaseDomainVerifiedAt"
    | "localBaseDomain"
  > | null,
): { source: "project-custom" | "org-base" | "local-base"; verified: boolean } | null {
  if (!sources) return null;
  const under = (apex: string | null) => {
    const a = apex?.trim().toLowerCase().replace(/\.$/, "");
    return Boolean(a) && domain.endsWith(`.${a}`);
  };
  if (under(sources.projectCustomDomain)) {
    return { source: "project-custom", verified: sources.projectCustomDomainVerifiedAt != null };
  }
  if (under(sources.orgBaseDomain)) {
    return { source: "org-base", verified: sources.orgBaseDomainVerifiedAt != null };
  }
  // Dev wildcard: same trust-by-construction as a generated mint, never ACME.
  if (under(sources.localBaseDomain)) {
    return { source: "local-base", verified: false };
  }
  return null;
}

/**
 * Normalize an operator-supplied "public URL" into a bare hostname, or null
 * when nothing host-like survives. The loose stripping (scheme, path, port)
 * is shared with the wizard via `stripToHostname`; this adds the API's real
 * FQDN validation on top. The compose wizard's exposed-domain seed goes
 * through this, because its value often starts life as an address env var
 * (`https://netbird.acme.com`).
 */
export function normalizePublicHostInput(input: string): string | null {
  const host = stripToHostname(input);
  return host ? normalizeDomain(host) : null;
}
/**
 * The route fields a domain rewrite implies. Re-verification resets the route
 * to unverified-and-disabled: a host that has to prove itself again must not
 * keep serving, or keep its old ACME decision, in the meantime.
 */
/**
 * DNS that already resolves to this server is proof of control. The same
 * thing the TXT challenge exists to establish, and the same thing ACME's
 * HTTP-01 would conclude. Lives here with the other domain decisions so all
 * three call sites (add, recheck, update) read one rule.
 */
export function provenByDns(state: DnsState): boolean {
  return state === "pointed";
}

/**
 * The route fields a domain edit writes, choosing between the two rewrite
 * models:
 *
 * A GENERATED route renamed WITHIN a platform apex stays generated: the
 * apex's own verification vouches for every label under it, so the route
 * keeps its enabled state and verification through the rename (see
 * {@link platformApexFor}). ACME mirrors the mint/recheck rules: a verified
 * apex is trusted, and DNS observed pointing here is proof on its own.
 *
 * Everything else goes through {@link domainUpdatePatch}, the custom-domain
 * rewrite with its re-verification rules.
 */
export function domainRewritePatch(args: {
  domain: string;
  route: ProxyRouteRecord;
  serviceName: string;
  dnsState: DnsState;
  requiresVerification: boolean;
  apex: ReturnType<typeof platformApexFor>;
}) {
  const { domain, route, serviceName, dnsState, requiresVerification, apex } = args;
  if (apex && route.source === "generated") {
    return {
      domain,
      source: "generated" as const,
      dnsState,
      dnsCheckedAt: new Date(),
      usesAcme: acmeForPlatformHost({
        domain,
        isLocalBase: apex.source === "local-base",
        apexVerified: apex.verified,
        dnsState,
      }),
      upstreamHost: serviceName,
    };
  }
  return domainUpdatePatch({ domain, route, serviceName, dnsState, requiresVerification });
}

function domainUpdatePatch(args: {
  domain: string;
  route: ProxyRouteRecord;
  serviceName: string;
  dnsState: DnsState;
  requiresVerification: boolean;
}) {
  const { domain, route, serviceName, dnsState, requiresVerification } = args;
  // A re-verification that the DNS has ALREADY satisfied is not a
  // verification, it is a formality. This branch used to reset ownership to
  // null and disable the route without ever consulting dnsState: even though
  // it is measured immediately before the call and passed in right here. Point
  // a host at this server and rename a route onto it and you were told to add
  // a TXT record to prove something the resolver had just proven. Worst on
  // sslip.io hosts, where the IP is encoded in the name and no other party can
  // ever claim it.
  const proven = requiresVerification && provenByDns(dnsState);
  return {
    domain,
    source: "custom" as const,
    dnsState,
    dnsCheckedAt: new Date(),
    // Re-verification genuinely resets the decision: the host has to prove
    // itself again. Otherwise this is an edit to a route that already exists
    // (a port change, say), so the same rule as recheck applies: don't pull a
    // working certificate out from under it. See acmeForExistingRoute.
    usesAcme: requiresVerification
      ? proven && acmeFor(domain, dnsState)
      : acmeForExistingRoute({
          domain,
          dnsState,
          currentUsesAcme: route.usesAcme,
          certState: route.certState,
        }),
    upstreamHost: serviceName,
    domainVerifyToken: requiresVerification
      ? randomBytes(24).toString("base64url")
      : route.domainVerifyToken,
    domainVerifiedAt: requiresVerification ? (proven ? new Date() : null) : route.domainVerifiedAt,
    enabled: requiresVerification ? proven : route.enabled,
  };
}
