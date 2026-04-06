import { describe, expect, test } from "bun:test";

import {
  buildCaddyConfig,
  buildHttpApp,
  buildLayer4App,
  buildLayer4Route,
  buildProjectConfig,
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

  test("buildLayer4Route produces SNI match and proxy handler", () => {
    const output = buildLayer4Route(layer4Route);
    expect(output.match[0]!.tls.sni).toEqual(["primary-acme.db.otterstack.dev"]);
    expect(output.handle[0]!.handler).toBe("tls");
    expect(output.handle[1]!.handler).toBe("proxy");
    expect((output.handle[1] as { upstreams: { dial: string[] }[] }).upstreams[0]!.dial).toEqual(["primary-acme.otterstack.internal:5432"]);
  });

  test("buildLayer4App creates a server listening on :5432", () => {
    const output = buildLayer4App([layer4Route]);
    expect(output.servers.postgres.listen).toEqual([":5432"]);
    expect(output.servers.postgres.routes).toHaveLength(1);
  });

  test("buildHttpApp creates a server with host matching and reverse_proxy", () => {
    const output = buildHttpApp([httpRoute]);
    expect(output.servers.web.listen).toEqual([":443"]);
    expect(output.servers.web.routes[0]!.match[0]!.host).toEqual(["myapp-acme.otterstack.dev"]);
    expect(output.servers.web.routes[0]!.handle[0]!.handler).toBe("reverse_proxy");
  });

  test("buildCaddyConfig assembles admin + layer4 + http apps", () => {
    const output = buildCaddyConfig([httpRoute, layer4Route], "0.0.0.0:2019");
    expect(output.admin.listen).toBe("0.0.0.0:2019");
    expect(output.apps.layer4).toBeDefined();
    expect(output.apps.http).toBeDefined();
  });

  test("buildCaddyConfig with only http routes omits layer4", () => {
    const output = buildCaddyConfig([httpRoute], "0.0.0.0:2019");
    expect(output.apps.http).toBeDefined();
    expect(output.apps.layer4).toBeUndefined();
  });

  test("buildCaddyConfig with only layer4 routes omits http", () => {
    const output = buildCaddyConfig([layer4Route], "0.0.0.0:2019");
    expect(output.apps.layer4).toBeDefined();
    expect(output.apps.http).toBeUndefined();
  });

  test("buildCaddyConfig with empty routes produces minimal config", () => {
    const output = buildCaddyConfig([], "0.0.0.0:2019");
    expect(output.admin.listen).toBe("0.0.0.0:2019");
    expect(Object.keys(output.apps)).toHaveLength(0);
  });

  test("buildProjectConfig uses admin off", () => {
    const output = buildProjectConfig([layer4Route]);
    expect(output.admin.listen).toBe("off");
  });
});
