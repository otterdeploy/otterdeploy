/**
 * Custom-domain management for the Service primitive (add-and-go model).
 *
 * A service publishes on several hosts, each one a `proxy_route` row tied
 * to the service resource (so per-route deployment protection + guests
 * apply per domain), each routed at a container port of its own. A DNS
 * reachability check on add classifies where the host currently resolves,
 * which drives both the cert decision and whether it serves immediately:
 *
 *   pointed   — resolves to our server IP ⇒ live now, real Let's Encrypt
 *               cert. Publishing that record is itself proof of control.
 *   proxied   — resolves into a Cloudflare edge range ⇒ that address is
 *               shared, so it proves nothing: the TXT gate still applies.
 *               Once verified, Cloudflare terminates TLS and the origin
 *               serves `tls internal`.
 *   unpointed — not pointed here yet ⇒ inert until the TXT proof or the A
 *               record lands (the UI shows both records to publish).
 *
 * Domains ARE the exposure — there is no separate public-access switch.
 * Adding the first host turns exposure on; removing the last turns it off.
 * Exactly one route per resource is flagged `isPrimary`; its domain is
 * mirrored into serviceResource.publicDomain so panel/graph/views keep
 * reading a single string.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";
import { randomBytes } from "node:crypto";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import {
  clearPrimaryForResource,
  deleteProxyRoute,
  getProxyRouteByDomain,
  getProxyRouteById,
  insertProxyRoute,
  listProxyRoutesByResourceId,
  type ProxyRouteRecord,
  updateProxyRoute,
} from "../../caddy/queries";
import { verifyDomainTxt } from "../../lib/dns-verify";
import { checkDomainReachability } from "../../lib/domain-reachability";
import { loadResource } from "./context";
import {
  acmeFor,
  acmeForExistingRoute,
  domainUpdatePatch,
  isReservedControlPlaneDomain,
  normalizeDomain,
  serverIpFor,
  type ServiceDomainView,
  toDomainView,
} from "./domain-rules";
import { provenByDns, resolveUpstreamPort } from "./domains-check";
import {
  DomainConflictError,
  DomainNotFoundError,
  NoHttpPortError,
  type ServiceNotFoundError,
  UnknownPortError,
} from "./errors";
import { type ResourceRef } from "./inputs";
import { setPublicExposure, setServicePublicDomain, type ServiceRecord } from "./queries";
import { isUniqueViolation } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

export async function addServiceDomain(
  input: ResourceRef & { domain: string; port?: number },
  log: RequestLogger,
): Promise<
  Result<ServiceDomainView, NotFound | NoHttpPortError | UnknownPortError | DomainConflictError>
> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record } = ctx.value;

  const domain = normalizeDomain(input.domain);
  if (!domain || (await isReservedControlPlaneDomain(domain))) {
    return Result.err(new DomainConflictError({ domain: input.domain }));
  }

  const upstreamPort = resolveUpstreamPort(record, input.resourceId, input.port);
  if (upstreamPort.isErr()) return Result.err(upstreamPort.error);

  const clash = await getProxyRouteByDomain(domain);
  if (clash) return Result.err(new DomainConflictError({ domain }));

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain, serverIp });
  // DNS that already resolves to this server is proof of control (see
  // `provenByDns`) — those hosts serve immediately. Anything else stays inert
  // behind the per-route TXT challenge until Recheck observes it.
  const live = provenByDns(reachability.state);
  const existing = await listProxyRoutesByResourceId(input.resourceId);

  let route: ProxyRouteRecord;
  try {
    route = await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "http",
      domain,
      upstreamHost: record.service.serviceName,
      upstreamPort: upstreamPort.value,
      protocol: "http",
      usesAcme: live && acmeFor(domain, reachability.state),
      enabled: live,
      source: "custom",
      // First host on the service is the one everything else mirrors.
      isPrimary: existing.length === 0,
      dnsState: reachability.state,
      dnsCheckedAt: new Date(),
      domainVerifyToken: randomBytes(24).toString("base64url"),
      domainVerifiedAt: live ? new Date() : null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return Result.err(new DomainConflictError({ domain }));
    throw error;
  }

  // A service with a domain IS a public service — there is no second switch
  // to find. Adding the first host turns exposure on; the route itself still
  // waits on its own DNS/ownership before it serves anything.
  if (route.isPrimary || !record.service.publicEnabled) {
    await setPublicExposure({
      resourceId: input.resourceId,
      enabled: true,
      publicDomain: route.isPrimary ? domain : (record.service.publicDomain ?? domain),
    });
  }
  if (route.enabled) await reconcile(log);

  log.set({
    domain: { action: "add", domain, dnsState: reachability.state, port: upstreamPort.value, live },
  });
  return Result.ok(toDomainView(route, serverIp));
}

/** Load a route and confirm it belongs to the addressed resource — folds
 *  "missing" and "wrong resource" into one 404 so existence never leaks.
 *  Exported for the pause/resume slice in ./domains-enabled. */
export async function loadOwnedRoute(
  input: ResourceRef & { routeId: ProxyRouteId },
): Promise<
  Result<{ route: ProxyRouteRecord; record: ServiceRecord }, NotFound | DomainNotFoundError>
> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const route = await getProxyRouteById(input.routeId);
  if (!route || route.resourceId !== input.resourceId || route.projectId !== input.projectId) {
    return Result.err(new DomainNotFoundError({ routeId: input.routeId }));
  }
  return Result.ok({ route, record: ctx.value.record });
}

export async function recheckServiceDomain(
  input: ResourceRef & { routeId: ProxyRouteId },
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | DomainNotFoundError>> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route, record } = owned.value;

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain: route.domain, serverIp });
  // Generated hosts are ours by construction, and a host that now resolves to
  // this server has proven itself the same way ACME would — either way there
  // is nothing left for the TXT challenge to establish.
  const ownership =
    route.source === "generated" || provenByDns(reachability.state)
      ? { ok: true }
      : await verifyDomainTxt({
          domain: route.domain,
          expectedToken: route.domainVerifyToken,
        });
  const domainVerifiedAt =
    route.source === "generated"
      ? route.domainVerifiedAt
      : (route.domainVerifiedAt ?? (ownership.ok ? new Date() : null));
  const ownershipVerified = route.source === "generated" || domainVerifiedAt !== null;
  // acmeForExistingRoute, not acmeFor: a recheck must not revoke working TLS
  // just because DNS now reads `proxied` (e.g. the operator put Cloudflare in
  // front). See domain-rules.ts.
  const usesAcme =
    ownershipVerified &&
    acmeForExistingRoute({
      domain: route.domain,
      dnsState: reachability.state,
      currentUsesAcme: route.usesAcme,
      certState: route.certState,
    });
  const enabled = ownershipVerified && record.service.publicEnabled;

  const updated = await updateProxyRoute(input.routeId, {
    dnsState: reachability.state,
    dnsCheckedAt: new Date(),
    usesAcme,
    domainVerifiedAt,
    enabled,
    upstreamHost: record.service.serviceName,
  });
  if (!updated) return Result.err(new DomainNotFoundError({ routeId: input.routeId }));

  // Re-render if the cert decision flipped (e.g. DNS just started pointing
  // here → switch from self-signed to ACME) and the route is live.
  if (updated.enabled !== route.enabled || (updated.enabled && usesAcme !== route.usesAcme)) {
    await reconcile(log);
  }

  log.set({ domain: { action: "recheck", domain: route.domain, dnsState: reachability.state } });
  return Result.ok(toDomainView(updated, serverIp));
}

export async function updateServiceDomain(
  input: ResourceRef & { routeId: ProxyRouteId; domain: string; port?: number },
  log: RequestLogger,
): Promise<
  Result<ServiceDomainView, NotFound | DomainNotFoundError | DomainConflictError | UnknownPortError>
> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route, record } = owned.value;

  const domain = normalizeDomain(input.domain);
  if (!domain || (await isReservedControlPlaneDomain(domain))) {
    return Result.err(new DomainConflictError({ domain: input.domain }));
  }

  // An omitted port keeps the one this host already routes to — editing the
  // hostname alone must not silently re-point the route at the primary. (So
  // this path can't hit "service has no HTTP port": there's always the port
  // the route is already using to fall back on.)
  let upstreamPort = route.upstreamPort;
  if (input.port != null) {
    const match = record.ports.find((p) => p.containerPort === input.port);
    if (!match) {
      return Result.err(new UnknownPortError({ resourceId: input.resourceId, port: input.port }));
    }
    upstreamPort = match.containerPort;
  }

  if (domain !== route.domain) {
    const clash = await getProxyRouteByDomain(domain);
    if (clash) return Result.err(new DomainConflictError({ domain }));
  }

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain, serverIp });
  const changed = domain !== route.domain;
  const requiresVerification = changed || route.source !== "custom";

  let updated: ProxyRouteRecord | undefined;
  try {
    updated = await updateProxyRoute(input.routeId, {
      ...domainUpdatePatch({
        domain,
        route,
        serviceName: record.service.serviceName,
        dnsState: reachability.state,
        requiresVerification,
      }),
      upstreamPort,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return Result.err(new DomainConflictError({ domain }));
    throw error;
  }
  if (!updated) return Result.err(new DomainNotFoundError({ routeId: input.routeId }));

  // Keep the mirror in step if we rewrote the primary host.
  if (updated.isPrimary) {
    await setServicePublicDomain(input.resourceId, updated.domain);
  }
  // Re-render so the old host stops being served and the new one takes over.
  if (route.enabled || updated.enabled) await reconcile(log);

  log.set({ domain: { action: "update", from: route.domain, to: domain } });
  return Result.ok(toDomainView(updated, serverIp));
}

export async function setPrimaryServiceDomain(
  input: ResourceRef & { routeId: ProxyRouteId },
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | DomainNotFoundError>> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);

  await clearPrimaryForResource(input.resourceId);
  const updated = await updateProxyRoute(input.routeId, { isPrimary: true });
  if (!updated) return Result.err(new DomainNotFoundError({ routeId: input.routeId }));
  await setServicePublicDomain(input.resourceId, updated.domain);

  // No reconcile: the routed host set is unchanged, only which one we
  // advertise as canonical.
  log.set({ domain: { action: "set-primary", domain: updated.domain } });
  return Result.ok(toDomainView(updated, await serverIpFor(input)));
}

export async function removeServiceDomain(
  input: ResourceRef & { routeId: ProxyRouteId },
  log: RequestLogger,
): Promise<Result<{ ok: true }, NotFound | DomainNotFoundError>> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route } = owned.value;

  const all = await listProxyRoutesByResourceId(input.resourceId);
  await deleteProxyRoute(input.routeId);
  const survivors = all.filter((r) => r.id !== input.routeId);

  if (survivors.length === 0) {
    // Domains ARE the exposure: removing the last host puts the service back
    // on the project network only, rather than leaving `publicEnabled` true
    // with nothing to reach it by.
    await setPublicExposure({ resourceId: input.resourceId, enabled: false, publicDomain: null });
  } else if (route.isPrimary) {
    // Promote a survivor: prefer a live host, fall back to any remaining
    // route, and mirror it.
    const next = survivors.find((r) => r.enabled) ?? survivors[0];
    if (next) {
      await updateProxyRoute(next.id, { isPrimary: true });
      await setServicePublicDomain(input.resourceId, next.domain);
    }
  }

  // The removed host was (possibly) live; re-render to stop serving it.
  await reconcile(log);
  log.set({ domain: { action: "remove", domain: route.domain } });
  return Result.ok({ ok: true });
}
