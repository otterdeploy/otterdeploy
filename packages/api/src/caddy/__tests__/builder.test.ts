import { describe, expect, test } from "bun:test";

import {
  buildCaddyfile,
  buildGlobalBlock,
  buildHttpBlock,
  buildLayer4Route,
  buildValidationWrapper,
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

  test("buildLayer4Route produces matcher and route block", () => {
    const output = buildLayer4Route(layer4Route);
    expect(output).toContain("@pg_primary_acme_db_otterstack_dev tls {");
    expect(output).toContain("alpn postgresql");
    expect(output).toContain("sni primary-acme.db.otterstack.dev");
    expect(output).toContain("proxy primary-acme.otterstack.internal:5432");
  });

  test("buildGlobalBlock includes layer4 routes in listener_wrappers", () => {
    const output = buildGlobalBlock([layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("listener_wrappers {");
    expect(output).toContain("layer4 {");
    expect(output).toContain("sni primary-acme.db.otterstack.dev");
    expect(output).toContain("tls\n");
  });

  test("buildGlobalBlock omits listener_wrappers when no layer4 routes", () => {
    const output = buildGlobalBlock([], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).not.toContain("listener_wrappers");
    expect(output).not.toContain("layer4");
  });

  test("buildCaddyfile assembles global block + http blocks", () => {
    const output = buildCaddyfile([httpRoute, layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("myapp-acme.otterstack.dev {");
    expect(output).toContain("reverse_proxy myapp.acme.otterstack.internal:3000");
    expect(output).toContain("sni primary-acme.db.otterstack.dev");
    expect(output).toContain("proxy primary-acme.otterstack.internal:5432");
  });

  test("buildCaddyfile with only http routes omits layer4", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("myapp-acme.otterstack.dev {");
    expect(output).not.toContain("layer4");
  });

  test("buildCaddyfile with empty routes produces minimal global block", () => {
    const output = buildCaddyfile([], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).not.toContain("reverse_proxy");
    expect(output).not.toContain("layer4");
  });

  test("buildValidationWrapper wraps layer4 routes in global block for validation", () => {
    const output = buildValidationWrapper([layer4Route]);
    expect(output).toContain("admin off");
    expect(output).toContain("listener_wrappers {");
    expect(output).toContain("layer4 {");
    expect(output).toContain("sni primary-acme.db.otterstack.dev");
  });

  test("buildValidationWrapper passes http routes as standalone site blocks", () => {
    const output = buildValidationWrapper([httpRoute]);
    expect(output).toContain("myapp-acme.otterstack.dev {");
    expect(output).not.toContain("listener_wrappers");
  });

  test("buildValidationWrapper handles mixed routes", () => {
    const output = buildValidationWrapper([httpRoute, layer4Route]);
    expect(output).toContain("admin off");
    expect(output).toContain("listener_wrappers {");
    expect(output).toContain("myapp-acme.otterstack.dev {");
    expect(output).toContain("sni primary-acme.db.otterstack.dev");
  });
});
