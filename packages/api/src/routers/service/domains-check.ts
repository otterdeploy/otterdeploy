/**
 * Reads and port arithmetic for service domains. Listing a service's hosts,
 * and the questions the add/edit form asks before it commits to anything.
 *
 * Split out of ./domains.ts, which owns the writes. Nothing here mutates:
 * `checkServiceDomain` reserves no name, so a `true` can still lose a race
 * and `addServiceDomain` remains the authority on whether a host is yours.
 */

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { loadCustomCertHosts } from "../../caddy/certs";
import { getProxyRouteByDomain, listProxyRoutesByResourceId } from "../../caddy/queries";
import { loadResource } from "./context";
import {
  isReservedControlPlaneDomain,
  normalizeDomain,
  serverIpFor,
  type ServiceDomainView,
  toDomainView,
} from "./domain-rules";
import { NoHttpPortError, type ServiceNotFoundError, UnknownPortError } from "./errors";
import { type ResourceRef } from "./inputs";
import { getPrimaryHttpPort, type ServiceRecord } from "./queries";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

/** Why a host can't be taken. `ok` is the available case. */
export type DomainAvailability = "ok" | "invalid" | "reserved" | "taken";

/**
 * Which container port a host proxies to. Omitting the choice means "the
 * primary HTTP port": the single-port case, and what every pre-port-picker
 * caller expects. An explicit port must be one the service actually
 * publishes: routing a domain at a port nothing listens on is a 502 with
 * extra steps, so it's refused rather than quietly rewritten.
 */
export function resolveUpstreamPort(
  record: ServiceRecord,
  resourceId: ResourceRef["resourceId"],
  requested: number | undefined,
): Result<number, NoHttpPortError | UnknownPortError> {
  if (requested != null) {
    const match = record.ports.find((p) => p.containerPort === requested);
    if (!match) return Result.err(new UnknownPortError({ resourceId, port: requested }));
    return Result.ok(match.containerPort);
  }
  const primary = getPrimaryHttpPort(record.ports);
  if (!primary) return Result.err(new NoHttpPortError({ resourceId }));
  return Result.ok(primary.containerPort);
}

/**
 * Does DNS already prove this name is the operator's? On a single-org install
 * a host resolving here (or through a proxy pointed here) does; on a
 * multi-org install it never does, because it cannot say WHICH org owns the
 * name, so the TXT ownership gate always applies. See domain-rules.ts.
 */
export { provenByDns } from "./domain-rules";

/**
 * Is this host well-formed, free, and ours to take? Answers the add form's
 * Available / Taken line without writing anything.
 */
export async function checkServiceDomain(
  input: ResourceRef & { domain: string },
): Promise<Result<{ domain: string; available: boolean; reason: DomainAvailability }, NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const normalized = normalizeDomain(input.domain);
  if (!normalized) {
    return Result.ok({
      domain: input.domain.trim().toLowerCase(),
      available: false,
      reason: "invalid",
    });
  }
  if (await isReservedControlPlaneDomain(normalized)) {
    return Result.ok({ domain: normalized, available: false, reason: "reserved" });
  }
  const clash = await getProxyRouteByDomain(normalized);
  return Result.ok({ domain: normalized, available: !clash, reason: clash ? "taken" : "ok" });
}

/** Every host this service publishes on, primary first. */
export async function listServiceDomains(
  input: ResourceRef,
): Promise<Result<ServiceDomainView[], NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const [routes, dnsTarget] = await Promise.all([
    listProxyRoutesByResourceId(input.resourceId),
    serverIpFor(input),
  ]);
  const customCertHosts = await loadCustomCertHosts(
    input.organizationId,
    routes.map((r) => r.domain),
  );
  return Result.ok(routes.map((r) => toDomainView(r, dnsTarget, customCertHosts)));
}
