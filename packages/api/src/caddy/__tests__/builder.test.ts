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
    domain: "myapp-acme.otterstack.dev",
    upstreamHost: "myapp.acme.otterstack.internal",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
  };

  const layer4Route: ProxyRouteInput = {
    projectId: "project_abc",
    type: "layer4",
    domain: "primary-acme.db.otterstack.dev",
    upstreamHost: "primary-acme.otterstack.internal",
    upstreamPort: 5432,
    protocol: "tcp",
    layer4Alpn: "postgresql",
  };

  test("sanitizeMatcherName converts domain to safe identifier", () => {
    expect(sanitizeMatcherName("primary-acme.db.otterstack.dev")).toBe(
      "primary_acme_db_otterstack_dev",
    );
  });

  test("buildHttpBlock produces a site block with reverse_proxy", () => {
    const output = buildHttpBlock(httpRoute);
    expect(output).toBe(
      [
        "myapp-acme.otterstack.dev {",
        "\treverse_proxy myapp.acme.otterstack.internal:3000",
        "}",
      ].join("\n"),
    );
  });

  test("buildLayer4Block produces TLS SNI matcher with connection_policy", () => {
    const output = buildLayer4Block([layer4Route]);
    expect(output).toContain("@primary_acme_db_otterstack_dev tls sni primary-acme.db.otterstack.dev");
    expect(output).toContain("route @primary_acme_db_otterstack_dev {");
    expect(output).toContain("tls {");
    expect(output).toContain("connection_policy {");
    expect(output).toContain("alpn postgresql");
    expect(output).toContain("proxy primary-acme.otterstack.internal:5432");
    expect(output).toContain(":5432 {");
  });

  test("buildCaddyfile includes layer4 + http + cert automation site block", () => {
    const output = buildCaddyfile([httpRoute, layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("layer4 {");
    expect(output).toContain(":5432 {");
    expect(output).toContain("tls sni primary-acme.db.otterstack.dev");
    expect(output).toContain("myapp-acme.otterstack.dev {");
    expect(output).toContain("reverse_proxy myapp.acme.otterstack.internal:3000");
    // Dummy site block for cert automation
    expect(output).toContain('respond "ok" 200');
  });

  test("buildCaddyfile with only http routes omits layer4", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    expect(output).toContain("myapp-acme.otterstack.dev {");
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
    expect(output).toContain("tls sni primary-acme.db.otterstack.dev");
    expect(output).toContain("connection_policy {");
  });

  test("buildProjectFragment returns empty string for no routes", () => {
    expect(buildProjectFragment([])).toBe("");
  });
});
