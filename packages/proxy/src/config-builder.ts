import crypto from "node:crypto";
import type { CaddyRoute, RouteTarget, RouteOpts } from "./types";
import {
  createReverseProxyHandler,
  createCompressionHandler,
  createSecurityHeadersHandler,
} from "./middleware";

export function buildRouteId(resourceId: string, domain: string): string {
  const hash = crypto.createHash("sha256").update(domain).digest("hex");
  return `route-${resourceId}-${hash.slice(0, 6)}`;
}

export function buildRoute(
  target: RouteTarget,
  opts?: RouteOpts,
): CaddyRoute {
  const routeId = buildRouteId(target.resourceId, target.domain);

  const handlers = [];

  if (opts?.compression) {
    handlers.push(createCompressionHandler());
  }

  if (opts?.securityHeaders) {
    handlers.push(createSecurityHeadersHandler());
  }

  handlers.push(createReverseProxyHandler(target.upstream, target.port));

  const match: Array<{ host?: string[]; path?: string[] }> = [
    { host: [target.domain] },
  ];

  if (opts?.pathPrefix) {
    match[0].path = [`${opts.pathPrefix}*`];
  }

  return {
    "@id": routeId,
    match,
    handle: handlers,
    terminal: true,
  };
}
