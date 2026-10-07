/**
 * The reach rules for raw per-route directives, beyond the bead's
 * own corpus (custom-directives-admin.test.ts): spellings that only differ
 * from it in how Caddy lexes them, the same rules on the adapted JSON, and
 * the reconciler refusing a fragment whose adapted JSON breaks them.
 */
import { customDirectivesSchema } from "@otterdeploy/shared/custom-directives";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ProxyRouteInput } from "../builder";

import { adaptedReachError } from "../directive-reach";
import { reconcileRoutes } from "../reconciler";

function rejection(text: string): string | null {
  const parsed = customDirectivesSchema.safeParse(text);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "rejected");
}

describe("the write schema reads directives the way Caddy lexes them", () => {
  it.each([
    ["a backslash-continued line", "reverse_proxy od-shop-api:80 \\\n127.0.0.1:2019"],
    ["a continuation hidden in a comment", "reverse_proxy od-shop-api:80 # \\\n127.0.0.1:2019"],
    ["a non-breaking space as separator", "reverse_proxy 127.0.0.1:2019"],
    ["a quoted upstream", 'reverse_proxy "unix//run/caddy-admin/admin.sock"'],
    ["a to subdirective", "reverse_proxy {\n\tto od-shop-api:80 localhost:9000\n}"],
    ["a dynamic upstream", "reverse_proxy {\n\tdynamic a localhost 2019\n}"],
    ["a request-time placeholder upstream", "reverse_proxy {http.request.header.X-Target}"],
    ["an env-substituted upstream", "reverse_proxy unix/{$CADDY_ADMIN_SOCKET_PATH}"],
    ["a non-canonical loopback", "reverse_proxy 0x7f.1:8080"],
    ["an IPv4-mapped loopback", "reverse_proxy [::ffff:127.0.0.1]:8080"],
    ["a host-less port (dials localhost)", "reverse_proxy :8080"],
    ["the admin port on any host", "reverse_proxy caddy:2019"],
    ["forward_auth to the admin socket", "forward_auth unix//run/caddy-admin/admin.sock"],
    ["the root var set directly", "vars root /data\nfile_server"],
    ["a traversal out of /srv", "root * /srv/../etc/caddy\nfile_server"],
    ["a {file.*} read of a private key", "respond {file./data/caddy/certificates/x.key}"],
    ["tls loading the edge's own key", "tls /data/caddy/cert.crt /data/caddy/cert.key"],
    ["a log written over the Caddyfile", "log {\n\toutput file /etc/caddy/Caddyfile\n}"],
    ["an env read", "respond {env.HOME}"],
  ])("%s is rejected with a reason", (_label, text) => {
    expect(rejection(text)).toMatch(/route directives|Environment placeholders/);
  });

  it("a `}` hidden from a naive comment scan still cannot close the site block", () => {
    // `a#b` is ONE token to Caddy, so the `}` after it is structure.
    const escape = "header X a#b }\nevil.example.com {\n\trespond hi\n}\nfake x#y {";
    expect(rejection(escape)).toMatch(/Braces must balance/);
  });

  it.each([
    ["a CORS header naming localhost", "header Access-Control-Allow-Origin http://localhost:3000"],
    ["a URL path that looks like /data", "@data path /data/*\nhandle @data {\n\trespond 404\n}"],
    ["an external upstream", "reverse_proxy /api/* https://api.example.com"],
    ["file_server under /srv", "root * /srv/site\nfile_server"],
    [
      "a rate-limit zone keyed on a placeholder",
      "rate_limit {\n\tzone z {\n\t\tkey {remote_host}\n\t}\n}",
    ],
  ])("%s is still accepted", (_label, text) => {
    expect(rejection(text)).toBeNull();
  });
});

describe("the same rules on Caddy's adapted JSON", () => {
  const site = (handle: unknown[]) => ({
    apps: {
      http: {
        servers: {
          srv0: { routes: [{ handle: [{ handler: "subroute", routes: [{ handle }] }] }] },
        },
      },
    },
  });

  it("rejects a reverse_proxy that dials the admin socket", () => {
    const json = site([
      { handler: "reverse_proxy", upstreams: [{ dial: "unix//run/caddy-admin/admin.sock" }] },
    ]);
    expect(adaptedReachError(json)).toMatch(/Unix socket/);
  });

  it("rejects a file_server rooted outside /srv and the root var feeding it", () => {
    expect(adaptedReachError(site([{ handler: "file_server", root: "/data" }]))).toMatch(/\/srv/);
    expect(adaptedReachError(site([{ handler: "vars", root: "/etc/caddy" }]))).toMatch(/\/srv/);
  });

  it("rejects a {file.*} read anywhere in the config", () => {
    const json = site([{ handler: "static_response", body: "{file./data/caddy/x.key}" }]);
    expect(adaptedReachError(json)).toMatch(/\{file\.\*\}/);
  });

  it("accepts a reverse_proxy to a project service and ordinary handlers", () => {
    const json = site([
      { handler: "headers", response: { set: { "X-Robots-Tag": ["noindex"] } } },
      { handler: "reverse_proxy", upstreams: [{ dial: "od-shop-api:8080" }] },
    ]);
    expect(adaptedReachError(json)).toBeNull();
  });
});

describe("the reconciler holds adapted JSON to the reach rules", () => {
  const route: ProxyRouteInput = {
    projectId: "project_abc",
    type: "http",
    domain: "myapp.otterdeploy.dev",
    upstreamHost: "otterdeploy-abc-myapp",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    usesAcme: false,
  };
  const hostileJson = {
    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:2019" }] }],
  };

  it("skips a project whose directives adapt to a forbidden handler", async () => {
    const result = await reconcileRoutes({
      routes: [{ ...route, customDirectives: 'header X-Robots-Tag "noindex"' }],
      adminBind: "unix//run/caddy-admin/admin.sock|0600",
      adapt: vi.fn(() => Promise.resolve({ ok: true as const, json: hostileJson })),
      load: vi.fn(() => Promise.resolve({ ok: true as const })),
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      { projectId: "project_abc", error: expect.stringMatching(/port 2019/) },
    ]);
  });

  it("does not judge a fragment with no custom directives", async () => {
    const result = await reconcileRoutes({
      routes: [route],
      adminBind: "unix//run/caddy-admin/admin.sock|0600",
      adapt: vi.fn(() => Promise.resolve({ ok: true as const, json: hostileJson })),
      load: vi.fn(() => Promise.resolve({ ok: true as const })),
    });
    expect(result.applied).toEqual(["project_abc"]);
  });
});
