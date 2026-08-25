/**
 * The rename/re-port edit for one published host (`service.domains.update`).
 * Split out of domains.ts (add/recheck/primary/remove) to keep both files
 * under the line cap.
 *
 * The one rule that matters here: a GENERATED host renamed WITHIN a platform
 * apex (org base / project custom domain) stays generated and keeps serving.
 * Everything else re-verifies as a custom host. The fork itself lives in
 * `domainRewritePatch` (domain-rules.ts) so it stays a pure, testable
 * decision.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { reconcile } from "../../caddy";
import {
  getProxyRouteByDomain,
  type ProxyRouteRecord,
  updateProxyRoute,
} from "../../caddy/queries";
import { checkDomainReachability } from "../../lib/domain-reachability";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import {
  domainRewritePatch,
  isReservedControlPlaneDomain,
  normalizeDomain,
  platformApexFor,
  type ServiceDomainView,
  toDomainView,
} from "./domain-rules";
import { loadOwnedRoute } from "./domains";
import {
  DomainConflictError,
  DomainNotFoundError,
  type ServiceNotFoundError,
  UnknownPortError,
} from "./errors";
import { type ResourceRef } from "./inputs";
import { setServicePublicDomain, type ServiceRecord } from "./queries";
import { isUniqueViolation } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

/** An omitted port keeps the one this host already routes to. Editing the
 *  hostname alone must not silently re-point the route at the primary. (So
 *  this path can't hit "service has no HTTP port": there's always the port
 *  the route is already using to fall back on.) */
function resolveEditedPort(
  route: ProxyRouteRecord,
  record: ServiceRecord,
  input: ResourceRef & { port?: number },
): Result<number, UnknownPortError> {
  if (input.port == null) return Result.ok(route.upstreamPort);
  const match = record.ports.find((p) => p.containerPort === input.port);
  if (!match) {
    return Result.err(new UnknownPortError({ resourceId: input.resourceId, port: input.port }));
  }
  return Result.ok(match.containerPort);
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

  const upstreamPort = resolveEditedPort(route, record, input);
  if (upstreamPort.isErr()) return Result.err(upstreamPort.error);

  if (domain !== route.domain) {
    const clash = await getProxyRouteByDomain(domain);
    if (clash) return Result.err(new DomainConflictError({ domain }));
  }

  const sources = await loadDomainSourcesForProject(input.projectId);
  const serverIp = sources ? sources.serverIp : null;
  const reachability = await checkDomainReachability({ domain, serverIp });
  const changed = domain !== route.domain;
  const requiresVerification = changed || route.source !== "custom";

  const patch = domainRewritePatch({
    domain,
    route,
    serviceName: record.service.serviceName,
    dnsState: reachability.state,
    requiresVerification,
    apex: platformApexFor(domain, sources),
  });

  let updated: ProxyRouteRecord | undefined;
  try {
    updated = await updateProxyRoute(input.routeId, {
      ...patch,
      upstreamPort: upstreamPort.value,
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
