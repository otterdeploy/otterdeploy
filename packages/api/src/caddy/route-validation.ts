import { routePolicySchema } from "@otterdeploy/shared/route-policy";

import type { ProxyRouteInput } from "./builder";

import { PLATFORM } from "../constants";

const FQDN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;

/**
 * Prefixes a swarm service may legitimately carry, read from the constants the
 * generators use rather than restated here. Hard-coding the shape is what let
 * this guard drift out of step with service naming and reject every real route
 * (`od-…` from service/handlers.ts, and unprefixed `${stack}-${service}` from
 * stack/compose/to-spec.ts) until both were fixed. Only the first is ever
 * minted; the rest keep pre-rename services routable.
 */
const MANAGED_SERVICE_PREFIXES = [
  PLATFORM.service.serviceNamePrefix,
  ...PLATFORM.service.legacyServiceNamePrefixes,
] as const;

const SERVICE_SUFFIX = /^[a-z0-9][a-z0-9-]*$/;

function isManagedServiceName(host: string): boolean {
  if (host.length < 1 || host.length > 63) return false;
  return MANAGED_SERVICE_PREFIXES.some(
    (prefix) => host.startsWith(prefix) && SERVICE_SUFFIX.test(host.slice(prefix.length)),
  );
}
const DATABASE_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.otterdeploy\.internal$/;

/**
 * Defense-in-depth validation at the final config boundary. Database strings
 * never become Caddyfile tokens unless they match identities minted by the
 * control plane. In particular, tenant routes cannot target loopback, public
 * IPs, control-plane service names, arbitrary Docker aliases, or other
 * projects' ambiguous short aliases.
 */
/** Who this route is allowed to point at, by identity rather than by string. */
function upstreamViolation(route: ProxyRouteInput): string | null {
  if (route.projectId === "control-plane") {
    return ["server", "host.docker.internal"].includes(route.upstreamHost)
      ? null
      : "control-plane route has an unexpected upstream";
  }
  if (route.type === "http" && !isManagedServiceName(route.upstreamHost)) {
    return "HTTP upstream is not a managed service identity";
  }
  if (route.type === "layer4" && !DATABASE_NAME.test(route.upstreamHost)) {
    return "layer-4 upstream is not a managed database identity";
  }
  return null;
}

/** The protocol fields have to agree with the route type they claim to be. */
function protocolViolation(route: ProxyRouteInput): string | null {
  if (route.type === "http" && (route.protocol !== "http" || route.layer4Alpn !== null)) {
    return "HTTP route protocol fields are inconsistent";
  }
  if (route.type === "layer4" && (route.protocol !== "tcp" || route.layer4Alpn !== "postgresql")) {
    return "layer-4 route protocol is not allowlisted";
  }
  return null;
}

export function routeValidationError(route: ProxyRouteInput): string | null {
  if (!FQDN.test(route.domain) || route.domain !== route.domain.toLowerCase()) {
    return "route domain is not a canonical DNS name";
  }
  if (
    !Number.isInteger(route.upstreamPort) ||
    route.upstreamPort < 1 ||
    route.upstreamPort > 65_535
  ) {
    return "route upstream port is outside 1-65535";
  }

  const upstream = upstreamViolation(route);
  if (upstream) return upstream;

  const protocol = protocolViolation(route);
  if (protocol) return protocol;

  if (route.routePolicy && !routePolicySchema.safeParse(route.routePolicy).success) {
    return "route policy is invalid";
  }
  return null;
}

export function assertSafeRoute(route: ProxyRouteInput): void {
  const error = routeValidationError(route);
  if (error) throw new Error(`Unsafe proxy route: ${error}.`);
}
