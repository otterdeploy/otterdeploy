/**
 * Public-exposure orchestration for the Service primitive: `exposeService` /
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
  listProxyRoutesByResourceId,
  setRoutesEnabledForResource,
  updateProxyRoute,
} from "../../caddy/queries";
import { loadResource } from "./context";
import { type ServiceDomainView, toDomainView } from "./domain-rules";
import {
  DomainConflictError,
  NoHttpPortError,
  NoPublicDomainError,
  ServiceNotFoundError,
} from "./errors";
import { insertGeneratedRoute, resolveGeneratedDomain } from "./expose-generated";
import { getService } from "./get-service";
import { type ResourceRef } from "./inputs";
import { getPrimaryHttpPort, setPublicExposure } from "./queries";
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
): Promise<
  Result<ServiceView, NotFound | NoHttpPortError | NoPublicDomainError | DomainConflictError>
> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { project, record } = ctx.value;

  const primary = getPrimaryHttpPort(record.ports);
  if (!primary) {
    return Result.err(new NoHttpPortError({ resourceId: input.resourceId }));
  }

  // A service can carry several hosts (one proxy_route each). Expose no
  // longer wipes-and-reinserts a single route: that would drop the
  // operator's custom domains and their guests. It brings already-verified
  // hosts back live, and guarantees at least one live host by minting the
  // generated one whenever nothing else is serving.
  await setRoutesEnabledForResource(input.resourceId, true);
  await refreshRouteUpstreams(input.resourceId, primary.containerPort, record.service.serviceName);

  let routes = await listProxyRoutesByResourceId(input.resourceId);
  if (!routes.some((r) => r.enabled)) {
    const { resolved, serverIp } = await resolveGeneratedDomain(
      input,
      record,
      sanitizeSlug(project.slug),
    );
    // No real domain resolved. The only host we could publish on is the
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
    const inserted = await insertGeneratedRoute(
      input,
      record,
      resolved,
      serverIp,
      primary.containerPort,
      routes,
    );
    if (inserted.isErr()) return Result.err(inserted.error);
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

/**
 * Mint the platform-generated host for this service and publish on it.
 *
 * This is the "Generate Domain" button, not a toggle: it always yields a
 * generated host, where `exposeService` only mints one when nothing else is
 * already serving. Asking for the host IS the opt-in, so there is no sslip
 * confirmation prompt in the way: the returned view says plainly which kind
 * of host was minted and the card explains what that means.
 *
 * Idempotent: a service that already has its generated host gets that row
 * back (re-enabled), not a duplicate.
 */
export async function generateServiceDomain(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | NoHttpPortError | DomainConflictError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { project, record } = ctx.value;

  const primary = getPrimaryHttpPort(record.ports);
  if (!primary) return Result.err(new NoHttpPortError({ resourceId: input.resourceId }));

  const { resolved, serverIp } = await resolveGeneratedDomain(
    input,
    record,
    sanitizeSlug(project.slug),
  );
  const routes = await listProxyRoutesByResourceId(input.resourceId);
  const existing = routes.find((r) => r.domain === resolved.fqdn);

  if (existing) {
    await updateProxyRoute(existing.id, {
      enabled: true,
      upstreamHost: record.service.serviceName,
      upstreamPort: primary.containerPort,
    });
  } else {
    const inserted = await insertGeneratedRoute(
      input,
      record,
      resolved,
      serverIp,
      primary.containerPort,
      routes,
    );
    if (inserted.isErr()) return Result.err(inserted.error);
  }

  const after = await listProxyRoutesByResourceId(input.resourceId);
  const route = after.find((r) => r.domain === resolved.fqdn);
  if (!route) return Result.err(new DomainConflictError({ domain: resolved.fqdn }));

  await setPublicExposure({
    resourceId: input.resourceId,
    // The generated host becomes the advertised one only when nothing else
    // has claimed primary. An operator's custom domain outranks it.
    enabled: true,
    publicDomain: (await settlePrimaryRoute(input.resourceId, after)) ?? resolved.fqdn,
  });
  await reconcile(log);

  log.set({ domain: { action: "generate", domain: resolved.fqdn, source: resolved.source } });
  return Result.ok(toDomainView(route, serverIp));
}

export async function unexposeService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  // Disable every host without deleting the rows: the operator's custom
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
