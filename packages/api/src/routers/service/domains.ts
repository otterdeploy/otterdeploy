/**
 * Custom-domain management for the Service primitive (add-and-go model).
 *
 * A service publishes on several hosts, each one a `proxy_route` row tied
 * to the service resource (so per-route deployment protection + guests
 * apply per domain). A custom host goes live the moment it's added — no
 * ownership gate. A DNS reachability check classifies where the host
 * currently resolves and drives the cert decision:
 *
 *   pointed   — resolves to our server IP ⇒ real Let's Encrypt cert
 *   proxied   — resolves into a Cloudflare edge range ⇒ Cloudflare
 *               terminates TLS; origin serves `tls internal`
 *   unpointed — not pointed here yet ⇒ self-signed until DNS lands
 *               (non-blocking; the UI shows the A record to add)
 *
 * Verification is implicit: Let's Encrypt's HTTP-01 challenge only succeeds
 * for a name that actually points here, so a working A record + issued cert
 * is the proof of control. The check is a pre-flight convenience.
 *
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
import { checkDomainReachability } from "../../lib/domain-reachability";
import { verifyDomainTxt } from "../../lib/dns-verify";
import { loadResource } from "./context";
import {
  acmeFor,
  domainUpdatePatch,
  isReservedControlPlaneDomain,
  normalizeDomain,
  serverIpFor,
  type ServiceDomainView,
  toDomainView,
} from "./domain-rules";
import {
  DomainConflictError,
  DomainNotFoundError,
  NoHttpPortError,
  type ServiceNotFoundError,
} from "./errors";
import { type ResourceRef } from "./inputs";
import { getPrimaryHttpPort, setServicePublicDomain, type ServiceRecord } from "./queries";
import { isUniqueViolation } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listServiceDomains(
  input: ResourceRef,
): Promise<Result<ServiceDomainView[], NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const [routes, dnsTarget] = await Promise.all([
    listProxyRoutesByResourceId(input.resourceId),
    serverIpFor(input),
  ]);
  return Result.ok(routes.map((r) => toDomainView(r, dnsTarget)));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function addServiceDomain(
  input: ResourceRef & { domain: string },
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | NoHttpPortError | DomainConflictError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record } = ctx.value;

  const domain = normalizeDomain(input.domain);
  if (!domain || (await isReservedControlPlaneDomain(domain))) {
    return Result.err(new DomainConflictError({ domain: input.domain }));
  }

  const primaryPort = getPrimaryHttpPort(record.ports);
  if (!primaryPort) {
    return Result.err(new NoHttpPortError({ resourceId: input.resourceId }));
  }

  const clash = await getProxyRouteByDomain(domain);
  if (clash) return Result.err(new DomainConflictError({ domain }));

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain, serverIp });
  let route: ProxyRouteRecord;
  try {
    // Ownership first: a route is inert until its per-route TXT challenge is
    // observed. Pointing an A record at this server is not proof that this
    // organization controls the name.
    route = await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "http",
      domain,
      upstreamHost: record.service.serviceName,
      upstreamPort: primaryPort.containerPort,
      protocol: "http",
      usesAcme: false,
      enabled: false,
      source: "custom",
      isPrimary: false,
      dnsState: reachability.state,
      dnsCheckedAt: new Date(),
      domainVerifyToken: randomBytes(24).toString("base64url"),
    });
  } catch (error) {
    if (isUniqueViolation(error)) return Result.err(new DomainConflictError({ domain }));
    throw error;
  }

  log.set({ domain: { action: "add", domain, dnsState: reachability.state } });
  return Result.ok(toDomainView(route, serverIp));
}

/** Load a route and confirm it belongs to the addressed resource — folds
 *  "missing" and "wrong resource" into one 404 so existence never leaks. */
async function loadOwnedRoute(
  input: ResourceRef & { routeId: ProxyRouteId },
): Promise<
  Result<
    { route: ProxyRouteRecord; record: ServiceRecord },
    NotFound | DomainNotFoundError
  >
> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const route = await getProxyRouteById(input.routeId);
  if (
    !route ||
    route.resourceId !== input.resourceId ||
    route.projectId !== input.projectId
  ) {
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
  const ownership =
    route.source === "generated"
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
  const usesAcme = ownershipVerified && acmeFor(route.domain, reachability.state);
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
  input: ResourceRef & { routeId: ProxyRouteId; domain: string },
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | DomainNotFoundError | DomainConflictError>> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route, record } = owned.value;

  const domain = normalizeDomain(input.domain);
  if (!domain || (await isReservedControlPlaneDomain(domain))) {
    return Result.err(new DomainConflictError({ domain: input.domain }));
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
    updated = await updateProxyRoute(
      input.routeId,
      domainUpdatePatch({
        domain,
        route,
        serviceName: record.service.serviceName,
        dnsState: reachability.state,
        requiresVerification,
      }),
    );
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

  if (route.isPrimary) {
    // Promote a survivor: prefer a live host, fall back to any remaining
    // route, and mirror it. If none remain the service has no public host —
    // clear the mirror.
    const survivors = all.filter((r) => r.id !== input.routeId);
    const next = survivors.find((r) => r.enabled) ?? survivors[0] ?? null;
    if (next) {
      await updateProxyRoute(next.id, { isPrimary: true });
      await setServicePublicDomain(input.resourceId, next.domain);
    } else {
      await setServicePublicDomain(input.resourceId, null);
    }
  }

  // The removed host was (possibly) live; re-render to stop serving it.
  await reconcile(log);
  log.set({ domain: { action: "remove", domain: route.domain } });
  return Result.ok({ ok: true });
}
