/**
 * The generated-host half of `exposeService` / `generateServiceDomain`:
 * which label the host is built from, where it resolves, what DNS state a
 * fresh mint records, and the insert-or-adopt write. Split out of expose.ts
 * to keep that file about orchestration (and under the line cap).
 */
import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import {
  getProxyRouteByDomain,
  insertProxyRoute,
  listProxyRoutesByResourceId,
  updateProxyRoute,
} from "../../caddy/queries";
import { checkDomainReachability, type DnsState } from "../../lib/domain-reachability";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain, type ResolvedDomain } from "../../lib/domains";
import { DomainConflictError } from "./errors";
import { type ResourceRef } from "./inputs";
import { type ServiceRecord } from "./queries";
import { isUniqueViolation, sanitizeSlug } from "./views";

type ProxyRoutes = Awaited<ReturnType<typeof listProxyRoutesByResourceId>>;

/**
 * The label a generated host is built from.
 *
 * Normally the resource name. For a compose stack's NAMESAKE service it is the
 * stack's name instead, because the resource name carries a dedup suffix the
 * operator never chose: a stack and its main service almost always share a name
 * (`drizzle-gateway` containing service `drizzle-gateway`, true of 51 of the
 * 54 catalog templates), names are unique per project, so the child lands as
 * `drizzle-gateway-service` and the URL became
 * `drizzle-gateway-service-store.…`.
 *
 * Using the stack's name is safe rather than clever: it is itself a resource
 * name in this project, so it is already unique, and the platform ALREADY
 * treats the compose key as canonical for addressing. `internal_hostname` on
 * that same row is the un-suffixed `drizzle-gateway`. This makes the public
 * name agree with the internal one instead of exposing a disambiguator.
 *
 * Deliberately narrow: only the child whose compose key equals its stack's
 * name. A sibling like `db` keeps its own label, so two stacks that each
 * contain a `db` cannot collide on one domain.
 */
async function generatedHostLabel(record: ServiceRecord): Promise<string> {
  const stackId = record.service.stackId;
  if (!stackId) return sanitizeSlug(record.resource.name);
  const [stack] = await db
    .select({ name: resource.name })
    .from(resource)
    .where(eq(resource.id, stackId))
    .limit(1);
  if (!stack) return sanitizeSlug(record.resource.name);
  const stackSlug = sanitizeSlug(stack.name);
  // `internalHostname` IS the compose service key for a stack child.
  return record.service.internalHostname === stackSlug
    ? stackSlug
    : sanitizeSlug(record.resource.name);
}

/** Resolve the host expose *would* mint when nothing else is serving. The
 *  chain resource-override → project → org → local → sslip fallback. Kept
 *  separate from the insert so the caller can inspect `source` (and refuse the
 *  sslip fallback) before anything is written. */
export async function resolveGeneratedDomain(
  input: ResourceRef,
  record: ServiceRecord,
  projectSlug: string,
): Promise<{ resolved: ResolvedDomain; serverIp: string | null }> {
  const resourceSlug = await generatedHostLabel(record);
  // Walk the chain (resource override → project → org → sslip). The
  // per-resource `publicDomain` column on serviceResource is what feeds
  // resourceOverride: operators who already typed a literal FQDN in
  // the service settings get it back untouched.
  const sources = (await loadDomainSourcesForProject(input.projectId)) ?? {
    resourceOverride: null,
    projectCustomDomain: null,
    projectCustomDomainVerifiedAt: null,
    orgBaseDomain: null,
    orgBaseDomainVerifiedAt: null,
    localBaseDomain: null,
    serverIp: null,
  };
  return {
    resolved: resolvePublicDomain(
      { resourceSlug, projectSlug, kind: "service" },
      { ...sources, resourceOverride: record.service.publicDomain },
    ),
    serverIp: sources.serverIp,
  };
}

/**
 * What a freshly minted generated route should record as its DNS state.
 *
 * sslip/local hosts resolve to us by construction: the answer is baked into
 * the name, so there is nothing to look up. Every other level (org base,
 * project custom, a typed resource override) is a REAL name whose wildcard or
 * A record the operator has to publish, and stamping those "pointed" sight
 * unseen was a standing lie: the row said reachable while nothing resolved.
 * Measure instead, so the domains card can say honestly whether the host the
 * platform just minted actually lands here.
 */
async function generatedRouteDnsState(
  resolved: ResolvedDomain,
  serverIp: string | null,
): Promise<{ dnsState: DnsState; dnsCheckedAt: Date | null }> {
  if (resolved.source === "sslip-fallback" || resolved.source === "local-base") {
    return { dnsState: "pointed", dnsCheckedAt: null };
  }
  const probe = await checkDomainReachability({ domain: resolved.fqdn, serverIp });
  return { dnsState: probe.state, dnsCheckedAt: new Date() };
}

/** Nothing live. Either a first expose or every host is still a pending
 *  custom. Mint the already-resolved host so expose actually exposes
 *  something.
 *
 *  `proxy_route.domain` is unique install-wide, so this insert can lose to a
 *  row we can't see from the resource (a leftover from a recreated resource,
 *  a preview route, another project whose slugs collide). That used to
 *  surface as a bare 500 on the confirm step; now the row is adopted when it
 *  is ours to adopt, and reported as a conflict when it isn't. */
export async function insertGeneratedRoute(
  input: ResourceRef,
  record: ServiceRecord,
  resolved: ResolvedDomain,
  serverIp: string | null,
  upstreamPort: number,
  routes: ProxyRoutes,
): Promise<Result<void, DomainConflictError>> {
  // sslip/local hosts are pointed by construction; real names are measured.
  const dns = await generatedRouteDnsState(resolved, serverIp);
  const fields = {
    upstreamHost: record.service.serviceName,
    upstreamPort,
    // ACME only when the resolver decided the domain is verified and not
    // a sslip fallback: same gate as the DB path.
    usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
    enabled: true,
    dnsState: dns.dnsState,
    dnsCheckedAt: dns.dnsCheckedAt,
  };
  try {
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "http",
      domain: resolved.fqdn,
      protocol: "http",
      source: "generated",
      // Becomes primary only if no other route already claims it.
      isPrimary: !routes.some((r) => r.isPrimary),
      ...fields,
    });
    return Result.ok();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await getProxyRouteByDomain(resolved.fqdn);
    // Only a base route already attached to THIS resource is safe to take
    // over; anything else belongs to another resource or preview and would
    // be hijacked by re-pointing it here.
    if (!existing || existing.resourceId !== input.resourceId || existing.previewId !== null) {
      return Result.err(new DomainConflictError({ domain: resolved.fqdn }));
    }
    await updateProxyRoute(existing.id, fields);
    return Result.ok();
  }
}
