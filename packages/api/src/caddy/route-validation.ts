import type { ProxyRouteInput } from "./builder";

import { routePolicySchema } from "@otterdeploy/shared/route-policy";

const FQDN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const SERVICE_NAME = /^(?=.{1,63}$)otterdeploy-[a-z0-9][a-z0-9-]*$/;
const DATABASE_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.otterdeploy\.internal$/;

/**
 * Defense-in-depth validation at the final config boundary. Database strings
 * never become Caddyfile tokens unless they match identities minted by the
 * control plane. In particular, tenant routes cannot target loopback, public
 * IPs, control-plane service names, arbitrary Docker aliases, or other
 * projects' ambiguous short aliases.
 */
export function routeValidationError(route: ProxyRouteInput): string | null {
  if (!FQDN.test(route.domain) || route.domain !== route.domain.toLowerCase()) {
    return "route domain is not a canonical DNS name";
  }
  if (!Number.isInteger(route.upstreamPort) || route.upstreamPort < 1 || route.upstreamPort > 65_535) {
    return "route upstream port is outside 1-65535";
  }
  if (route.projectId === "control-plane") {
    if (!["server", "host.docker.internal"].includes(route.upstreamHost)) {
      return "control-plane route has an unexpected upstream";
    }
  } else if (route.type === "http" && !SERVICE_NAME.test(route.upstreamHost)) {
    return "HTTP upstream is not a managed service identity";
  } else if (route.type === "layer4" && !DATABASE_NAME.test(route.upstreamHost)) {
    return "layer-4 upstream is not a managed database identity";
  }
  if (route.type === "http" && (route.protocol !== "http" || route.layer4Alpn !== null)) {
    return "HTTP route protocol fields are inconsistent";
  }
  if (
    route.type === "layer4" &&
    (route.protocol !== "tcp" || route.layer4Alpn !== "postgresql")
  ) {
    return "layer-4 route protocol is not allowlisted";
  }
  if (route.routePolicy && !routePolicySchema.safeParse(route.routePolicy).success) {
    return "route policy is invalid";
  }
  return null;
}

export function assertSafeRoute(route: ProxyRouteInput): void {
  const error = routeValidationError(route);
  if (error) throw new Error(`Unsafe proxy route: ${error}.`);
}
