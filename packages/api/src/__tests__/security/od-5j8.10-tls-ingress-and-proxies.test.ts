/**
 * od-5j8.10 — TLS-only control-plane ingress, trusted proxies, body limits.
 *
 * Invariant under test:
 *   1. Forwarding headers (X-Forwarded-For / X-Forwarded-Proto) are honored
 *      ONLY when the immediate TCP peer matches the configured trusted-proxy
 *      list — a spoofed header from an untrusted peer never wins, so it can't
 *      defeat rate limits, IP allowlists, the firewall/blocklist, or
 *      audit-log attribution.
 *   2. A request body over the configured cap is rejected with 413 before
 *      being fully buffered — from Content-Length alone when present, with
 *      route-specific overrides for legitimate bulk endpoints (source
 *      tarball uploads).
 *   3. The control plane's own dashboard/API route gets HSTS + hardening
 *      headers unconditionally once Caddy fronts it (od-5j8.6's typed route
 *      policy, not a bespoke header-setting path).
 *   4. Structural: the published prod compose never republishes the
 *      dashboard port to the world, and the trusted-proxy/body-limit gates
 *      are wired ahead of the rest of the middleware chain.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, test } from "vite-plus/test";

import { buildCaddyfile, buildHttpBlock, type ProxyRouteInput } from "../../caddy/builder";
import { CONTROL_PLANE_ROUTE_POLICY } from "../../caddy/control-plane-policy";
import {
  bodyLimitMiddleware,
  CONTROL_PLANE_BODY_LIMIT_RULES,
  DEFAULT_BODY_LIMIT_BYTES,
  MAX_SOURCE_UPLOAD_BYTES,
  resolveBodyLimitBytes,
} from "../../security/body-limit";
import {
  isTrustedProxyPeer,
  resolveClientAddress,
} from "../../security/trusted-proxy";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

// ─── 1. Trusted-proxy resolution ───────────────────────────────────────────

describe("[od-5j8.10] resolveClientAddress: forwarding headers only trusted from a trusted peer", () => {
  const trustedProxiesRaw = "127.0.0.1/32,::1/128,10.0.0.0/24";

  test("a peer NOT in the trusted list gets its forwarded headers ignored outright (spoofed IP does not win)", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4",
      "x-forwarded-proto": "https",
    });
    const resolved = resolveClientAddress({
      peerAddress: "203.0.113.9", // a public, non-trusted address
      headers,
      trustedProxiesRaw,
    });
    expect(resolved.trustedPeer).toBe(false);
    // The spoofed X-Forwarded-For value must NOT appear anywhere in the result.
    expect(resolved.ip).not.toBe("1.2.3.4");
    expect(resolved.ip).toBe("203.0.113.9");
    // Proto also isn't taken from the header when the peer is untrusted.
    expect(resolved.proto).toBe("http");
  });

  test("a peer IN the trusted list (loopback) has its forwarded headers honored", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.7, 10.0.0.1",
      "x-forwarded-proto": "https",
    });
    const resolved = resolveClientAddress({
      peerAddress: "127.0.0.1",
      headers,
      trustedProxiesRaw,
    });
    expect(resolved.trustedPeer).toBe(true);
    // First hop of X-Forwarded-For, not the trusted proxy's own address.
    expect(resolved.ip).toBe("198.51.100.7");
    expect(resolved.proto).toBe("https");
  });

  test("a peer inside a trusted CIDR range (not just an exact IP) is honored", () => {
    const resolved = resolveClientAddress({
      peerAddress: "10.0.0.42", // inside 10.0.0.0/24
      headers: new Headers({ "x-forwarded-for": "9.9.9.9" }),
      trustedProxiesRaw,
    });
    expect(resolved.trustedPeer).toBe(true);
    expect(resolved.ip).toBe("9.9.9.9");
  });

  test("a peer just outside a trusted CIDR range is rejected", () => {
    const resolved = resolveClientAddress({
      peerAddress: "10.0.1.1", // outside 10.0.0.0/24 (that's a /24, not /23)
      headers: new Headers({ "x-forwarded-for": "9.9.9.9" }),
      trustedProxiesRaw,
    });
    expect(resolved.trustedPeer).toBe(false);
    expect(resolved.ip).toBe("10.0.1.1");
  });

  test("no peer address at all (e.g. transport can't expose it) fails closed, not open", () => {
    const resolved = resolveClientAddress({
      peerAddress: null,
      headers: new Headers({ "x-forwarded-for": "1.2.3.4" }),
      trustedProxiesRaw,
    });
    expect(resolved.trustedPeer).toBe(false);
    expect(resolved.ip).toBe("unknown");
  });

  test("a trusted peer with no X-Forwarded-For falls back to its own address, not 'unknown'", () => {
    const resolved = resolveClientAddress({
      peerAddress: "127.0.0.1",
      headers: new Headers(),
      trustedProxiesRaw,
    });
    expect(resolved.trustedPeer).toBe(true);
    expect(resolved.ip).toBe("127.0.0.1");
    expect(resolved.proto).toBe("http");
  });

  test("an unrecognized X-Forwarded-Proto value from a trusted peer never becomes something other than http/https", () => {
    const resolved = resolveClientAddress({
      peerAddress: "127.0.0.1",
      headers: new Headers({ "x-forwarded-proto": "javascript:alert(1)" }),
      trustedProxiesRaw,
    });
    expect(resolved.proto).toBe("http");
  });
});

describe("[od-5j8.10] isTrustedProxyPeer / trusted-proxy list parsing", () => {
  test("the safe-by-default list trusts only loopback", () => {
    const defaultList = "127.0.0.1/32,::1/128";
    expect(isTrustedProxyPeer("127.0.0.1", defaultList)).toBe(true);
    expect(isTrustedProxyPeer("::1", defaultList)).toBe(true);
    expect(isTrustedProxyPeer("10.0.0.5", defaultList)).toBe(false);
    expect(isTrustedProxyPeer("203.0.113.9", defaultList)).toBe(false);
  });

  test("a hostname (not a literal IP) in the peer position never matches — fails closed", () => {
    expect(isTrustedProxyPeer("caddy", "127.0.0.1/32")).toBe(false);
    expect(isTrustedProxyPeer("evil.example.com", "127.0.0.1/32")).toBe(false);
  });

  test("a malformed trusted-proxy entry is skipped, not treated as trust-everything", () => {
    // "not-an-ip/8" and "" are garbage; a real client address must still not
    // match just because the list failed to parse cleanly.
    expect(isTrustedProxyPeer("203.0.113.9", "not-an-ip/8,,127.0.0.1/32")).toBe(false);
    expect(isTrustedProxyPeer("127.0.0.1", "not-an-ip/8,,127.0.0.1/32")).toBe(true);
  });

  test("an out-of-range CIDR prefix is skipped rather than silently widened", () => {
    // /99 isn't valid for IPv4 — must not be interpreted as "trust everything".
    expect(isTrustedProxyPeer("203.0.113.9", "10.0.0.0/99")).toBe(false);
  });

  test("empty peer address never matches", () => {
    expect(isTrustedProxyPeer(null, "0.0.0.0/0")).toBe(false);
  });
});

// ─── 2. Body limits ─────────────────────────────────────────────────────────

describe("[od-5j8.10] resolveBodyLimitBytes: per-route overrides", () => {
  test("an unmatched path gets the small default", () => {
    expect(resolveBodyLimitBytes("/rpc/certificates")).toBe(DEFAULT_BODY_LIMIT_BYTES);
    expect(resolveBodyLimitBytes("/api/auth/sign-in")).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  test("the source-upload route gets a much larger cap", () => {
    expect(resolveBodyLimitBytes("/api/services/svc_123/source")).toBe(MAX_SOURCE_UPLOAD_BYTES);
    expect(resolveBodyLimitBytes("/api/services/svc_123/source")).toBeGreaterThan(
      DEFAULT_BODY_LIMIT_BYTES,
    );
  });

  test("the default is a real, bounded cap — not effectively unlimited", () => {
    expect(DEFAULT_BODY_LIMIT_BYTES).toBeLessThan(MAX_SOURCE_UPLOAD_BYTES);
    expect(DEFAULT_BODY_LIMIT_BYTES).toBeGreaterThan(0);
  });

  test("rule prefixes are matched in order — first match wins", () => {
    const rules = [
      { prefix: "/api/services/special", maxBytes: 1 },
      { prefix: "/api/services/", maxBytes: 2 },
    ];
    expect(resolveBodyLimitBytes("/api/services/special/x", rules)).toBe(1);
    expect(resolveBodyLimitBytes("/api/services/other", rules)).toBe(2);
  });
});

describe("[od-5j8.10] bodyLimitMiddleware: oversized bodies are rejected with 413 before being fully buffered", () => {
  function appWithLimit() {
    const app = new Hono();
    app.use("*", bodyLimitMiddleware(CONTROL_PLANE_BODY_LIMIT_RULES, 1024)); // 1 KiB default for the test
    app.post("/echo", async (c) => {
      const body = await c.req.text();
      return c.text(`received:${body.length}`);
    });
    app.post("/api/services/svc_1/source", async (c) => {
      const body = await c.req.arrayBuffer();
      return c.text(`received:${body.byteLength}`);
    });
    return app;
  }

  test("a body under the cap is accepted", async () => {
    const app = appWithLimit();
    const res = await app.request("/echo", { method: "POST", body: "x".repeat(100) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("received:100");
  });

  test("a body over the default cap is rejected with 413 (Content-Length fast path — declared, never read)", async () => {
    const app = appWithLimit();
    // A real body larger than the 1 KiB test default; the runtime sets
    // Content-Length from its length, so the middleware's fast path fires
    // without ever touching the stream reader.
    const res = await app.request("/echo", { method: "POST", body: "x".repeat(5000) });
    expect(res.status).toBe(413);
  });

  test("the SAME oversized body is accepted on a route with a larger override (/api/services/*)", async () => {
    const app = appWithLimit();
    const res = await app.request("/api/services/svc_1/source", {
      method: "POST",
      body: "x".repeat(5000),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("received:5000");
  });

  test("a GET with no body is never touched by the middleware", async () => {
    const app = new Hono();
    app.use("*", bodyLimitMiddleware(CONTROL_PLANE_BODY_LIMIT_RULES, 1));
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(200);
  });

  test("the Content-Length fast path returns before any stream read — structural proof of no full buffering", () => {
    const mw = source("packages/api/src/security/body-limit.ts");
    // The Content-Length branch must `throw`/`return` before the
    // `getReader()` call that starts consuming the stream.
    const contentLengthBranchIndex = mw.indexOf("contentLength > maxBytes");
    const getReaderIndex = mw.indexOf("getReader()");
    expect(contentLengthBranchIndex).toBeGreaterThan(-1);
    expect(getReaderIndex).toBeGreaterThan(-1);
    expect(contentLengthBranchIndex).toBeLessThan(getReaderIndex);
  });
});

// ─── 3. Control-plane HSTS / hardening headers ─────────────────────────────

describe("[od-5j8.10] the control plane's own dashboard route carries HSTS + hardening headers", () => {
  const controlPlaneRoute: ProxyRouteInput = {
    projectId: "control-plane",
    type: "http",
    domain: "dashboard.example.com",
    upstreamHost: "server",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    usesAcme: true,
    routePolicy: CONTROL_PLANE_ROUTE_POLICY,
  };

  test("HSTS is enabled by default for the control-plane policy (unlike a tenant route's default-off policy)", () => {
    expect(CONTROL_PLANE_ROUTE_POLICY.hsts).not.toBe("off");
  });

  test("the rendered Caddyfile block for the control-plane route emits Strict-Transport-Security", () => {
    const block = buildHttpBlock(controlPlaneRoute);
    expect(block).toContain("Strict-Transport-Security");
    expect(block).toMatch(/max-age=31536000/);
  });

  test("the rendered block also emits nosniff, frame-deny, and a strict referrer policy", () => {
    const block = buildHttpBlock(controlPlaneRoute);
    expect(block).toContain("X-Content-Type-Options");
    expect(block).toMatch(/X-Frame-Options\s+"?DENY"?/);
    expect(block).toContain("Referrer-Policy");
  });

  test("the control-plane policy does not double-cap the body at the edge (enforced app-side instead)", () => {
    expect(CONTROL_PLANE_ROUTE_POLICY.maxRequestBodyMb).toBeNull();
  });

  test("HTTP→HTTPS redirect stays ON by default — the control-plane route doesn't disable it", () => {
    // buildCaddyfile only emits `auto_https disable_redirects` when the
    // caller explicitly opts out (httpsAutoRedirect === false); leaving it
    // unset/undefined — the default for every install — keeps Caddy's
    // automatic HTTP→HTTPS redirect for every site block, including this one.
    const caddyfile = buildCaddyfile([controlPlaneRoute], "unix//tmp/admin.sock|0600");
    expect(caddyfile).not.toContain("auto_https disable_redirects");
  });
});

// ─── 4. Structural: publish surface + middleware wiring ───────────────────

describe("[od-5j8.10] the published prod compose never republishes the dashboard to the world", () => {
  test("the control-plane port is bound to loopback only, not 0.0.0.0", () => {
    const compose = source("docker-compose.prod.yml");
    expect(compose).toMatch(/127\.0\.0\.1:\$\{CONTROL_PLANE_PORT:-3000\}:3000/);
    // The old bare "${CONTROL_PLANE_PORT:-3000}:3000" (published on every
    // interface) must be gone, not just supplemented.
    expect(compose).not.toMatch(/[^.\d]"\$\{CONTROL_PLANE_PORT:-3000\}:3000"/);
  });
});

describe("[od-5j8.10] trusted-proxy configuration exists and is safe by default", () => {
  test("TRUSTED_PROXIES is declared in the env schema with a loopback-only default", () => {
    const envSource = source("packages/env/src/server.ts");
    expect(envSource).toContain("TRUSTED_PROXIES");
    expect(envSource).toMatch(/default\(["']127\.0\.0\.1\/32,::1\/128["']\)/);
  });

  test("the installer detects and writes TRUSTED_PROXIES from the live edge network", () => {
    const install = source("scripts/install.sh");
    expect(install).toContain("detect_trusted_proxies");
    expect(install).toContain("TRUSTED_PROXIES=$trusted_proxies");
  });

  test("the installer no longer advertises the dashboard at a public/LAN address", () => {
    const install = source("scripts/install.sh");
    expect(install).not.toMatch(/Public IPv4:\s+http/);
    expect(install).toContain("ssh -L $CONTROL_PLANE_PORT:localhost:$CONTROL_PLANE_PORT");
  });
});

describe("[od-5j8.10] the trusted-proxy and body-limit gates are wired ahead of the rest of the middleware chain", () => {
  test("the server entrypoint applies both gates before the evlog middleware (which feeds the audit trail's IP)", () => {
    const entrypoint = source("apps/server/src/index.ts");
    const sanitizeIndex = entrypoint.indexOf("sanitizeForwardingHeaders(c)");
    const bodyLimitIndex = entrypoint.indexOf("bodyLimitMiddleware()");
    const evlogIndex = entrypoint.indexOf("evlog({");
    expect(sanitizeIndex).toBeGreaterThan(-1);
    expect(bodyLimitIndex).toBeGreaterThan(-1);
    expect(evlogIndex).toBeGreaterThan(-1);
    expect(sanitizeIndex).toBeLessThan(evlogIndex);
    expect(bodyLimitIndex).toBeLessThan(evlogIndex);
  });

  test("deploy-protection and inbound-webhook IP resolution go through the trusted-proxy helper, not a raw header read", () => {
    const sharedTsx = source("apps/server/src/handlers/deploy-protection/shared.tsx");
    const inboundTs = source("apps/server/src/handlers/webhooks/inbound.ts");
    expect(sharedTsx).toContain("resolveClient(c)");
    expect(inboundTs).toContain("resolveClient(c)");
    // The old direct-header pattern must be gone, not just supplemented.
    expect(sharedTsx).not.toContain('c.req.header("x-forwarded-for")');
    expect(inboundTs).not.toContain('c.req.header("x-forwarded-for")');
  });
});
