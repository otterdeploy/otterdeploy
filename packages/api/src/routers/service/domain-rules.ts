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
  // (project, resource) — mirrors the deployment-task view.
  projectId: string;
  resourceId: string;
  domain: string;
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
// schemes, paths, ports, and wildcards — those are caller errors, not hosts.
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

/** ACME can only issue for a publicly resolvable name that points at us. A
 *  `.localhost`/sslip host can't get a real cert, and a proxied/unpointed
 *  host's challenge can't complete — all stay on `tls internal`. */
export function acmeFor(domain: string, dnsState: DnsState): boolean {
  if (domain.endsWith(".localhost") || domain.endsWith(".sslip.io")) return false;
  return dnsState === "pointed";
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
export function domainUpdatePatch(args: {
  domain: string;
  route: ProxyRouteRecord;
  serviceName: string;
  dnsState: DnsState;
  requiresVerification: boolean;
}) {
  const { domain, route, serviceName, dnsState, requiresVerification } = args;
  return {
    domain,
    source: "custom" as const,
    dnsState,
    dnsCheckedAt: new Date(),
    usesAcme: requiresVerification ? false : acmeFor(domain, dnsState),
    upstreamHost: serviceName,
    domainVerifyToken: requiresVerification
      ? randomBytes(24).toString("base64url")
      : route.domainVerifyToken,
    domainVerifiedAt: requiresVerification ? null : route.domainVerifiedAt,
    enabled: requiresVerification ? false : route.enabled,
  };
}
