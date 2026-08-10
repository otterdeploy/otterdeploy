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
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import type { ProxyRouteRecord } from "../../caddy/queries";
import type { DnsState } from "../../lib/domain-reachability";
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
  /** live = rendered into Caddy now; disabled = service currently unexposed. */
  status: "live" | "disabled";
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

export function toDomainView(route: ProxyRouteRecord, dnsTarget: string | null): ServiceDomainView {
  return {
    id: route.id,
    projectId: route.projectId,
    // Service-domain routes are always tied to a resource (proxyRoute.resourceId
    // is nullable in general but never null for these), so it's safe to assert.
    resourceId: route.resourceId as string,
    domain: route.domain,
    port: route.upstreamPort,
    source: route.source,
    isPrimary: route.isPrimary,
    status: route.enabled ? "live" : "disabled",
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

export function domainUpdatePatch(args: {
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
