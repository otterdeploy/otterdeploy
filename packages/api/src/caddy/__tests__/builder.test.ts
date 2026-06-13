import { describe, expect, test } from "bun:test";

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
    upstreamHost: "myapp.acme.otterdeploy.internal",
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
        "\treverse_proxy myapp.acme.otterdeploy.internal:3000",
        "}",
      ].join("\n"),
    );
  });

  test("buildHttpBlock with usesAcme=true omits the tls directive (Caddy defaults to ACME)", () => {
    const output = buildHttpBlock({ ...httpRoute, usesAcme: true });
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\treverse_proxy myapp.acme.otterdeploy.internal:3000",
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
        "\t\treverse_proxy myapp.acme.otterdeploy.internal:3000",
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
    expect(output).toMatch(/myapp-acme\.otterdeploy\.dev \{[\s\S]*\tcrowdsec\n/);
  });

  test("crowdsec absent ⇒ no crowdsec directives (existing behaviour)", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    expect(output).not.toContain("crowdsec");
    expect(output).not.toContain("order crowdsec");
  });

  test("edgeLogSink emits per-site access log + request-id header", () => {
    const output = buildHttpBlock(httpRoute, { edgeLogSink: "host.docker.internal:9100" });
    expect(output).toContain("log {");
    expect(output).toContain("output net host.docker.internal:9100");
    expect(output).toContain("format json");
    expect(output).toContain("header X-Request-Id {http.request.uuid}");
    expect(output).toContain("request_header X-Request-Id {http.request.uuid}");
  });

  test("buildHttpBlock protected=false is unchanged (no forward_auth)", () => {
    const output = buildHttpBlock({ ...httpRoute, protected: false });
    expect(output).not.toContain("forward_auth");
    expect(output).toContain("reverse_proxy myapp.acme.otterdeploy.internal:3000");
  });

  test("buildLayer4Block produces TLS SNI matcher with connection_policy", () => {
    const output = buildLayer4Block([layer4Route]);
    expect(output).toContain("@primary_acme_db_otterdeploy_dev tls sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("route @primary_acme_db_otterdeploy_dev {");
    expect(output).toContain("tls {");
    expect(output).toContain("connection_policy {");
    expect(output).toContain("alpn postgresql");
    expect(output).toContain("proxy primary-acme.otterdeploy.internal:5432");
    expect(output).toContain(":5432 {");
  });

  test("buildCaddyfile includes layer4 + http + cert automation site block", () => {
    const output = buildCaddyfile([httpRoute, layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("layer4 {");
    expect(output).toContain(":5432 {");
    expect(output).toContain("tls sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("myapp-acme.otterdeploy.dev {");
    expect(output).toContain("reverse_proxy myapp.acme.otterdeploy.internal:3000");
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
    expect(output).toContain("layer4 {");
    expect(output).toContain("tls sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("connection_policy {");
  });

  test("buildProjectFragment returns empty string for no routes", () => {
    expect(buildProjectFragment([])).toBe("");
  });
});
