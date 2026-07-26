import { describe, expect, test } from "vite-plus/test";

import type { ProxyRouteInput } from "../builder";

import { PLATFORM } from "../../constants";
import { composeSwarmServiceName } from "../../stack/compose/to-spec";
import { routeValidationError } from "../route-validation";

/**
 * These tests exist because the guard once encoded its own idea of a service
 * name (`otterdeploy-…`) while the generators minted `od-…` and unprefixed
 * `${stack}-${service}`. Every fixture in the other caddy suites was
 * hand-written in the guard's shape, so nothing failed — meanwhile every real
 * HTTP route 500'd on `caddyfile` and the boot reconcile skipped them all.
 *
 * So: build the upstreams from the *real* generators, never from a literal.
 */
describe("route-validation", () => {
  const httpRoute = (upstreamHost: string): ProxyRouteInput => ({
    projectId: "project_abc",
    type: "http",
    domain: "myapp-acme.otterdeploy.dev",
    upstreamHost,
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    usesAcme: false,
  });

  test("accepts a git-sourced service name built the way handlers.ts builds it", () => {
    const serviceName = `${PLATFORM.service.serviceNamePrefix}storefront-web`.slice(0, 63);
    expect(routeValidationError(httpRoute(serviceName))).toBeNull();
  });

  test("accepts a compose sub-service name from composeSwarmServiceName", () => {
    const serviceName = composeSwarmServiceName("storefront-excalidraw", "excalidraw");
    expect(routeValidationError(httpRoute(serviceName))).toBeNull();
  });

  test("accepts pre-rename services still running under a legacy prefix", () => {
    for (const prefix of PLATFORM.service.legacyServiceNamePrefixes) {
      expect(routeValidationError(httpRoute(`${prefix}acme-myapp`))).toBeNull();
    }
  });

  test("still rejects a bare overlay alias", () => {
    // The pre-prefix compose shape, and exactly what a tenant could otherwise
    // point a route at.
    expect(routeValidationError(httpRoute("excalidraw"))).toBe(
      "HTTP upstream is not a managed service identity",
    );
    expect(routeValidationError(httpRoute("storefront-excalidraw-excalidraw"))).toBe(
      "HTTP upstream is not a managed service identity",
    );
  });

  test("still rejects loopback, control-plane and empty upstreams", () => {
    for (const host of ["127.0.0.1", "localhost", "server", "", "od-", "otterdeploy-"]) {
      expect(routeValidationError(httpRoute(host))).toBe(
        "HTTP upstream is not a managed service identity",
      );
    }
  });
});
