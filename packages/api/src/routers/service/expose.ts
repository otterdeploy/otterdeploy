/**
 * Public-exposure orchestration for the Service primitive — `exposeService` /
 * `unexposeService`. Split out of handlers.ts to keep that file under the line
 * cap; re-exported from there so the router import path is unchanged.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import {
  clearPrimaryForResource,
  insertProxyRoute,
  listProxyRoutesByResourceId,
  setRoutesEnabledForResource,
  updateProxyRoute,
} from "../../caddy/queries";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain, type ResolvedDomain } from "../../lib/domains";
import { loadResource } from "./context";
import { NoHttpPortError, NoPublicDomainError, ServiceNotFoundError } from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { getPrimaryHttpPort, setPublicExposure, type ServiceRecord } from "./queries";
import { sanitizeSlug, type ServiceView } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type ProxyRoutes = Awaited<ReturnType<typeof listProxyRoutesByResourceId>>;

/** Refresh each route's upstream in case the primary HTTP port moved while the
 *  service was unexposed. */
async function refreshRouteUpstreams(
  resourceId: ResourceId,
  upstreamPort: number,
  upstreamHost: string,
): Promise<void> {
  for (const r of await listProxyRoutesByResourceId(resourceId)) {
    if (r.upstreamPort !== upstreamPort || r.upstreamHost !== upstreamHost) {
      await updateProxyRoute(r.id, { upstreamPort, upstreamHost });
    }
  }
}

/** Resolve the host expose *would* mint when nothing else is serving — the
 *  chain resource-override → project → org → local → sslip fallback. Kept
 *  separate from the insert so the caller can inspect `source` (and refuse the
 *  sslip fallback) before anything is written. */
async function resolveGeneratedDomain(
  input: ResourceRef,
  record: ServiceRecord,
  projectSlug: string,
): Promise<ResolvedDomain> {
  const resourceSlug = sanitizeSlug(record.resource.name);
  // Walk the chain (resource override → project → org → sslip). The
  // per-resource `publicDomain` column on serviceResource is what feeds
  // resourceOverride — operators who already typed a literal FQDN in
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
  return resolvePublicDomain(
    { resourceSlug, projectSlug, kind: "service" },
    { ...sources, resourceOverride: record.service.publicDomain },
  );
}

/** Nothing live — either a first expose or every host is still a pending
 *  custom. Mint the already-resolved host so expose actually exposes
 *  something. */
async function insertGeneratedRoute(
  input: ResourceRef,
  record: ServiceRecord,
  resolved: ResolvedDomain,
  upstreamPort: number,
  routes: ProxyRoutes,
): Promise<void> {
  await insertProxyRoute({
    projectId: input.projectId,
    resourceId: input.resourceId,
    type: "http",
    domain: resolved.fqdn,
    upstreamHost: record.service.internalHostname,
    upstreamPort,
    protocol: "http",
    // ACME only when the resolver decided the domain is verified and not
    // a sslip fallback — same gate as the DB path.
    usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
    enabled: true,
    source: "generated",
    // Becomes primary only if no other route already claims it.
    isPrimary: !routes.some((r) => r.isPrimary),
    // Generated hosts resolve to us by construction (sslip/local/org apex).
    dnsState: "pointed",
  });
}

/** Settle the primary on a live host: keep the flagged one if it's live, else
 *  promote any live route (falling back to any route at all). Returns the
 *  primary host's domain, if any. */
async function settlePrimaryRoute(
  resourceId: ResourceId,
  routes: ProxyRoutes,
): Promise<string | null> {
  const flagged = routes.find((r) => r.isPrimary && r.enabled);
  const primaryRoute =
    flagged ?? routes.find((r) => r.enabled) ?? routes.find((r) => r.isPrimary) ?? routes[0];
  if (primaryRoute && !primaryRoute.isPrimary) {
    await clearPrimaryForResource(resourceId);
    await updateProxyRoute(primaryRoute.id, { isPrimary: true });
  }
  return primaryRoute?.domain ?? null;
}

export async function exposeService(
  input: ResourceRef,
  allowGeneratedDomain: boolean,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound | NoHttpPortError | NoPublicDomainError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { project, record } = ctx.value;

  const primary = getPrimaryHttpPort(record.ports);
  if (!primary) {
    return Result.err(new NoHttpPortError({ resourceId: input.resourceId }));
  }

  // A service can carry several hosts (one proxy_route each). Expose no
  // longer wipes-and-reinserts a single route — that would drop the
  // operator's custom domains and their guests. It brings already-verified
  // hosts back live, and guarantees at least one live host by minting the
  // generated one whenever nothing else is serving.
  await setRoutesEnabledForResource(input.resourceId, true);
  await refreshRouteUpstreams(
    input.resourceId,
    primary.containerPort,
    record.service.internalHostname,
  );

  let routes = await listProxyRoutesByResourceId(input.resourceId);
  if (!routes.some((r) => r.enabled)) {
    const resolved = await resolveGeneratedDomain(input, record, sanitizeSlug(project.slug));
    // No real domain resolved — the only host we could publish on is the
    // throwaway sslip.io fallback. Refuse unless the operator explicitly opted
    // in; the UI turns this into a "publish on <host>?" confirmation so a
    // service is never silently made public on a temporary URL.
    if (resolved.source === "sslip-fallback" && !allowGeneratedDomain) {
      return Result.err(
        new NoPublicDomainError({
          resourceId: input.resourceId,
          generatedDomain: resolved.fqdn,
        }),
      );
    }
    await insertGeneratedRoute(input, record, resolved, primary.containerPort, routes);
    routes = await listProxyRoutesByResourceId(input.resourceId);
  }

  const publicDomain = await settlePrimaryRoute(input.resourceId, routes);

  await setPublicExposure({
    resourceId: input.resourceId,
    enabled: true,
    publicDomain,
  });

  const reconcileResult = await reconcile(log);
  log.set({
    expose: {
      domain: publicDomain,
      applied: reconcileResult.applied.includes(input.projectId),
    },
  });

  return getService(input);
}

export async function unexposeService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  // Disable every host without deleting the rows — the operator's custom
  // domains, their verification, and their guests survive so a later
  // re-expose brings them straight back.
  await setRoutesEnabledForResource(input.resourceId, false);
  await setPublicExposure({
    resourceId: input.resourceId,
    enabled: false,
    publicDomain: null,
  });
  await reconcile(log);
  log.set({ unexpose: { service: ctx.value.record.service.serviceName } });

  return getService(input);
}
