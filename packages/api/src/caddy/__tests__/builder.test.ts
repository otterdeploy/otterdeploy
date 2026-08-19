import { describe, expect, test } from "vite-plus/test";

import {
  buildCaddyfile,
  buildHttpBlock,
  buildLayer4Block,
  buildProjectFragment,
  sanitizeMatcherName,
  type ProxyRouteInput,
} from "../builder";

describe("builder", () => {
  const httpRoute: ProxyRouteInput = {
    projectId: "project_abc",
    type: "http",
    domain: "myapp-acme.otterdeploy.dev",
    upstreamHost: "otterdeploy-acme-myapp",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    usesAcme: false,
  };

  const layer4Route: ProxyRouteInput = {
    projectId: "project_abc",
    type: "layer4",
    domain: "primary-acme.db.otterdeploy.dev",
    upstreamHost: "primary-acme.otterdeploy.internal",
    upstreamPort: 5432,
    protocol: "tcp",
    layer4Alpn: "postgresql",
    usesAcme: false,
  };

  test("sanitizeMatcherName converts domain to safe identifier", () => {
    expect(sanitizeMatcherName("primary-acme.db.otterdeploy.dev")).toBe(
      "primary_acme_db_otterdeploy_dev",
    );
  });

  test("buildHttpBlock with usesAcme=false emits tls internal", () => {
    const output = buildHttpBlock(httpRoute);
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\ttls internal",
        "\treverse_proxy otterdeploy-acme-myapp:3000",
        "}",
      ].join("\n"),
    );
  });

  test("buildHttpBlock with usesAcme=true omits the tls directive (Caddy defaults to ACME)", () => {
    const output = buildHttpBlock({ ...httpRoute, usesAcme: true });
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\treverse_proxy otterdeploy-acme-myapp:3000",
        "}",
      ].join("\n"),
    );
  });

  test("buildHttpBlock splices custom directives inside the site block, one indent level in", () => {
    const output = buildHttpBlock({
      ...httpRoute,
      usesAcme: true,
      customDirectives:
        'header X-Robots-Tag "noindex"\nhandle_errors {\n\trespond "oops" 502\n}',
    });
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\treverse_proxy otterdeploy-acme-myapp:3000",
        '\theader X-Robots-Tag "noindex"',
        "\thandle_errors {",
        '\t\trespond "oops" 502',
        "\t}",
        "}",
      ].join("\n"),
    );
  });

  test("buildHttpBlock drops a stored custom block that fails the brace-balance schema", () => {
    const output = buildHttpBlock({
      ...httpRoute,
      usesAcme: true,
      customDirectives: "}\nevil.example.com {\n\treverse_proxy 127.0.0.1:2019",
    });
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\treverse_proxy otterdeploy-acme-myapp:3000",
        "}",
      ].join("\n"),
    );
  });

  test("buildHttpBlock with protected=true emits forward_auth + ungated reserved-path handle", () => {
    const output = buildHttpBlock(
      { ...httpRoute, usesAcme: true, protected: true },
      { authzUpstream: "control-plane:3000" },
    );
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\thandle /.well-known/otterdeploy/* {",
        "\t\treverse_proxy control-plane:3000",
        "\t}",
        "\thandle {",
        "\t\trequest_header -Remote-User",
        "\t\trequest_header -Remote-Email",
        "\t\tforward_auth control-plane:3000 {",
        "\t\t\turi /api/internal/deploy-authz?domain=myapp-acme.otterdeploy.dev",
        "\t\t\tcopy_headers Remote-User Remote-Email",
        "\t\t}",
        "\t\treverse_proxy otterdeploy-acme-myapp:3000",
        "\t}",
        "}",
      ].join("\n"),
    );
  });

  test("crowdsec: global app config + order + per-site directive", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019", {
      crowdsec: { apiUrl: "http://crowdsec:8080", apiKey: "k3y" },
    });
    expect(output).toContain("order crowdsec first");
    expect(output).toContain("crowdsec {");
    expect(output).toContain("api_url http://crowdsec:8080");
    expect(output).toContain("api_key k3y");
    // per-site directive present on the http block
    expect(output).toMatch(
      /myapp-acme\.otterdeploy\.dev \{[\s\S]*\tcrowdsec\n/,
    );
  });

  test("crowdsec absent ⇒ no crowdsec directives (existing behaviour)", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    expect(output).not.toContain("crowdsec");
    expect(output).not.toContain("order crowdsec");
  });

  test("edgeLogSink emits per-site access log + request-id header", () => {
    const output = buildHttpBlock(httpRoute, {
      edgeLogSink: "host.docker.internal:9100",
    });
    expect(output).toContain("log {");
    expect(output).toContain("output net host.docker.internal:9100");
    expect(output).toContain("format json");
    expect(output).toContain("header X-Request-Id {http.request.uuid}");
    expect(output).toContain("request_header X-Request-Id {http.request.uuid}");
  });

  test("edgeLogSink emits a global default-logger sink (operational plane)", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019", {
      edgeLogSink: "host.docker.internal:9100",
    });
    // The global block (before the first site block) carries the default-logger
    // `log { output net … }` so Caddy's operational logs reach the same sink.
    const globalBlock = output.slice(0, output.indexOf("\n\n"));
    expect(globalBlock).toContain("log {");
    expect(globalBlock).toContain("output net host.docker.internal:9100");
    expect(globalBlock).toContain("format json");
  });

  test("edgeLogSink absent ⇒ no global log block (existing behaviour)", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    const globalBlock = output.slice(0, output.indexOf("\n\n"));
    expect(globalBlock).not.toContain("log {");
  });

  test("buildHttpBlock protected=false is unchanged (no forward_auth)", () => {
    const output = buildHttpBlock({ ...httpRoute, protected: false });
    expect(output).not.toContain("forward_auth");
    expect(output).toContain("reverse_proxy otterdeploy-acme-myapp:3000");
  });

  test("buildLayer4Block produces a listener-wrapper SNI+ALPN matcher (no :5432 listener)", () => {
    const output = buildLayer4Block([layer4Route]);
    // Listener wrapper on the existing :443 server, not a standalone listener.
    expect(output).toContain("servers {");
    expect(output).toContain("listener_wrappers {");
    expect(output).toContain("layer4 {");
    expect(output).not.toContain(":5432 {");
    // SNI *and* ALPN so the ACME TLS-ALPN-01 challenge falls through to `tls`.
    expect(output).toContain("@primary_acme_db_otterdeploy_dev tls {");
    expect(output).toContain("alpn postgresql");
    expect(output).toContain("sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("route @primary_acme_db_otterdeploy_dev {");
    expect(output).toContain("connection_policy {");
    expect(output).toContain("proxy primary-acme.otterdeploy.internal:5432");
    // Trailing `tls` wrapper terminates everything the layer4 wrapper skips.
    expect(output).toMatch(/\n\t\t\ttls\n/);
  });

  test("buildCaddyfile includes layer4 wrapper + http + cert automation site block", () => {
    const output = buildCaddyfile([httpRoute, layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("listener_wrappers {");
    expect(output).not.toContain(":5432 {");
    expect(output).toContain("sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("myapp-acme.otterdeploy.dev {");
    expect(output).toContain("reverse_proxy otterdeploy-acme-myapp:3000");
    // Dummy site block for cert automation
    expect(output).toContain('respond "ok" 200');
  });

  test("buildCaddyfile with only http routes omits layer4", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    expect(output).toContain("myapp-acme.otterdeploy.dev {");
    expect(output).not.toContain("layer4");
    expect(output).not.toContain("respond");
  });

  test("buildCaddyfile with empty routes produces minimal global block", () => {
    const output = buildCaddyfile([], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).not.toContain("reverse_proxy");
    expect(output).not.toContain("layer4");
  });

  test("buildProjectFragment wraps routes for validation with admin off", () => {
    const output = buildProjectFragment([layer4Route]);
    expect(output).toContain("admin off");
    expect(output).toContain("listener_wrappers {");
    expect(output).toContain("sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("connection_policy {");
  });

  test("buildProjectFragment returns empty string for no routes", () => {
    expect(buildProjectFragment([])).toBe("");
  });

  test("buildHttpBlock renders the complete allowlisted route policy", () => {
    const output = buildHttpBlock({
      ...httpRoute,
      routePolicy: {
        compression: "gzip-zstd",
        maxRequestBodyMb: 25,
        hsts: "preload",
        contentTypeNosniff: true,
        frameOptions: "deny",
        referrerPolicy: "strict-origin-when-cross-origin",
        contentSecurityPolicy: "default-src 'self'; object-src 'none'",
      },
    });
    expect(output).toContain("\tencode zstd gzip");
    expect(output).toContain("\t\tmax_size 25MB");
    expect(output).toContain(
      '\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains; preload"',
    );
    expect(output).toContain('\t\tX-Content-Type-Options "nosniff"');
    expect(output).toContain('\t\tX-Frame-Options "DENY"');
    expect(output).toContain(
      '\t\tReferrer-Policy "strict-origin-when-cross-origin"',
    );
    expect(output).toContain(
      `\t\tContent-Security-Policy "default-src 'self'; object-src 'none'"`,
    );
  });

  test("invalid persisted policy is rejected before Caddyfile rendering", () => {
    expect(() =>
      buildHttpBlock({
        ...httpRoute,
        routePolicy: {
          compression: "gzip",
          maxRequestBodyMb: null,
          hsts: "off",
          contentTypeNosniff: false,
          frameOptions: "off",
          referrerPolicy: "off",
          contentSecurityPolicy: "safe\n}\nfile_server /etc",
        },
      }),
    ).toThrow("Unsafe proxy route");
  });
});
