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
import { checkDomainReachability, type DnsState } from "../../lib/domain-reachability";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { loadResource } from "./context";
import {
  DomainConflictError,
  DomainNotFoundError,
  NoHttpPortError,
  type ServiceNotFoundError,
} from "./errors";
import { type ResourceRef } from "./inputs";
import { getPrimaryHttpPort, setServicePublicDomain } from "./queries";
import { isUniqueViolation } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface ServiceDomainView {
  id: string;
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
  /** The IP to point an A record at (our server). Null when unknown (dev). */
  dnsTarget: string | null;
}

function toDomainView(route: ProxyRouteRecord, dnsTarget: string | null): ServiceDomainView {
  return {
    id: route.id,
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

function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/\.$/, "");
  if (FQDN_RE.test(d) || LOCALHOST_RE.test(d)) return d;
  return null;
}

/** ACME can only issue for a publicly resolvable name that points at us. A
 *  `.localhost`/sslip host can't get a real cert, and a proxied/unpointed
 *  host's challenge can't complete — all stay on `tls internal`. */
function acmeFor(domain: string, dnsState: DnsState): boolean {
  if (domain.endsWith(".localhost") || domain.endsWith(".sslip.io")) return false;
  return dnsState === "pointed";
}

async function serverIpFor(ref: ResourceRef): Promise<string | null> {
  const sources = await loadDomainSourcesForProject(ref.projectId);
  return sources?.serverIp ?? null;
}

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
  if (!domain) return Result.err(new DomainConflictError({ domain: input.domain }));

  const primaryPort = getPrimaryHttpPort(record.ports);
  if (!primaryPort) {
    return Result.err(new NoHttpPortError({ resourceId: input.resourceId }));
  }

  const clash = await getProxyRouteByDomain(domain);
  if (clash) return Result.err(new DomainConflictError({ domain }));

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain, serverIp });
  const enabled = record.service.publicEnabled;

  let route: ProxyRouteRecord;
  try {
    // Add-and-go: live immediately if the service is exposed. The cert is
    // real (ACME) only once DNS points here; otherwise self-signed until
    // the operator points it and rechecks.
    route = await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "http",
      domain,
      upstreamHost: record.service.internalHostname,
      upstreamPort: primaryPort.containerPort,
      protocol: "http",
      usesAcme: acmeFor(domain, reachability.state),
      enabled,
      source: "custom",
      isPrimary: false,
      dnsState: reachability.state,
      dnsCheckedAt: new Date(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) return Result.err(new DomainConflictError({ domain }));
    throw error;
  }

  if (enabled) await reconcile(log);
  log.set({ domain: { action: "add", domain, dnsState: reachability.state } });
  return Result.ok(toDomainView(route, serverIp));
}

/** Load a route and confirm it belongs to the addressed resource — folds
 *  "missing" and "wrong resource" into one 404 so existence never leaks. */
async function loadOwnedRoute(
  input: ResourceRef & { routeId: ProxyRouteId },
): Promise<Result<{ route: ProxyRouteRecord }, NotFound | DomainNotFoundError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const route = await getProxyRouteById(input.routeId);
  if (!route || route.resourceId !== input.resourceId) {
    return Result.err(new DomainNotFoundError({ routeId: input.routeId }));
  }
  return Result.ok({ route });
}

export async function recheckServiceDomain(
  input: ResourceRef & { routeId: ProxyRouteId },
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | DomainNotFoundError>> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route } = owned.value;

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain: route.domain, serverIp });
  const usesAcme = acmeFor(route.domain, reachability.state);

  const updated = await updateProxyRoute(input.routeId, {
    dnsState: reachability.state,
    dnsCheckedAt: new Date(),
    usesAcme,
  });
  if (!updated) return Result.err(new DomainNotFoundError({ routeId: input.routeId }));

  // Re-render if the cert decision flipped (e.g. DNS just started pointing
  // here → switch from self-signed to ACME) and the route is live.
  if (updated.enabled && usesAcme !== route.usesAcme) await reconcile(log);

  log.set({ domain: { action: "recheck", domain: route.domain, dnsState: reachability.state } });
  return Result.ok(toDomainView(updated, serverIp));
}

export async function updateServiceDomain(
  input: ResourceRef & { routeId: ProxyRouteId; domain: string },
  log: RequestLogger,
): Promise<Result<ServiceDomainView, NotFound | DomainNotFoundError | DomainConflictError>> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route } = owned.value;

  const domain = normalizeDomain(input.domain);
  if (!domain) return Result.err(new DomainConflictError({ domain: input.domain }));

  if (domain !== route.domain) {
    const clash = await getProxyRouteByDomain(domain);
    if (clash) return Result.err(new DomainConflictError({ domain }));
  }

  const serverIp = await serverIpFor(input);
  const reachability = await checkDomainReachability({ domain, serverIp });

  let updated: ProxyRouteRecord | undefined;
  try {
    updated = await updateProxyRoute(input.routeId, {
      domain,
      source: "custom",
      dnsState: reachability.state,
      dnsCheckedAt: new Date(),
      usesAcme: acmeFor(domain, reachability.state),
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
  if (updated.enabled) await reconcile(log);

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
