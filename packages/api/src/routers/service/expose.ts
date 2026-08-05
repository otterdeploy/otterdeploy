/**
 * Public-exposure orchestration for the Service primitive — `exposeService` /
 * `unexposeService`. Split out of handlers.ts to keep that file under the line
 * cap; re-exported from there so the router import path is unchanged.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import {
  clearPrimaryForResource,
  getProxyRouteByDomain,
  insertProxyRoute,
  listProxyRoutesByResourceId,
  setRoutesEnabledForResource,
  updateProxyRoute,
} from "../../caddy/queries";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain, type ResolvedDomain } from "../../lib/domains";
import { loadResource } from "./context";
import { serverIpFor, type ServiceDomainView, toDomainView } from "./domain-rules";
import {
  DomainConflictError,
  NoHttpPortError,
  NoPublicDomainError,
  ServiceNotFoundError,
} from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { getPrimaryHttpPort, setPublicExposure, type ServiceRecord } from "./queries";
import { isUniqueViolation, sanitizeSlug, type ServiceView } from "./views";

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
/**
 * The label a generated host is built from.
 *
 * Normally the resource name. For a compose stack's NAMESAKE service it is the
 * stack's name instead, because the resource name carries a dedup suffix the
 * operator never chose: a stack and its main service almost always share a name
 * (`drizzle-gateway` containing service `drizzle-gateway` — true of 51 of the
 * 54 catalog templates), names are unique per project, so the child lands as
 * `drizzle-gateway-service` and the URL became
 * `drizzle-gateway-service-store.…`.
 *
 * Using the stack's name is safe rather than clever: it is itself a resource
 * name in this project, so it is already unique, and the platform ALREADY
 * treats the compose key as canonical for addressing — `internal_hostname` on
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

async function resolveGeneratedDomain(
  input: ResourceRef,
  record: ServiceRecord,
  projectSlug: string,
): Promise<ResolvedDomain> {
  const resourceSlug = await generatedHostLabel(record);
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
 *  something.
 *
 *  `proxy_route.domain` is unique install-wide, so this insert can lose to a
 *  row we can't see from the resource (a leftover from a recreated resource,
 *  a preview route, another project whose slugs collide). That used to
 *  surface as a bare 500 on the confirm step; now the row is adopted when it
 *  is ours to adopt, and reported as a conflict when it isn't. */
async function insertGeneratedRoute(
  input: ResourceRef,
  record: ServiceRecord,
  resolved: ResolvedDomain,
  upstreamPort: number,
  routes: ProxyRoutes,
): Promise<Result<void, DomainConflictError>> {
  const fields = {
    upstreamHost: record.service.serviceName,
    upstreamPort,
    // ACME only when the resolver decided the domain is verified and not
    // a sslip fallback — same gate as the DB path.
    usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
    enabled: true,
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
      // Generated hosts resolve to us by construction (sslip/local/org apex).
      dnsState: "pointed",
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
  // longer wipes-and-reinserts a single route — that would drop the
  // operator's custom domains and their guests. It brings already-verified
  // hosts back live, and guarantees at least one live host by minting the
  // generated one whenever nothing else is serving.
  await setRoutesEnabledForResource(input.resourceId, true);
  await refreshRouteUpstreams(input.resourceId, primary.containerPort, record.service.serviceName);

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
    const inserted = await insertGeneratedRoute(
      input,
      record,
      resolved,
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
 * confirmation prompt in the way — the returned view says plainly which kind
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

  const resolved = await resolveGeneratedDomain(input, record, sanitizeSlug(project.slug));
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
    // has claimed primary — an operator's custom domain outranks it.
    enabled: true,
    publicDomain: (await settlePrimaryRoute(input.resourceId, after)) ?? resolved.fqdn,
  });
  await reconcile(log);

  log.set({ domain: { action: "generate", domain: resolved.fqdn, source: resolved.source } });
  return Result.ok(toDomainView(route, await serverIpFor(input)));
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
