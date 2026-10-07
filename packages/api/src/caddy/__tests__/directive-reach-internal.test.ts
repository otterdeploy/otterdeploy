/**
 * Raw route directives cannot reach the platform's own services.
 *
 * directive-reach.test.ts covers the edge's own surface (admin API, sockets,
 * loopback, files). The edge also sits on the shared `otterdeploy` network
 * beside the control plane's postgres, redis, server, builder and crowdsec,
 * and on every project network, so platform service names are refused as
 * upstreams too. These are the context-free rules (the write schema and
 * the adapted JSON); directive-scope.test.ts covers the project-aware ones.
 */
import { customDirectivesSchema } from "@otterdeploy/shared/custom-directives";
import {
  hasMetricsDirective,
  upstreamReachError,
} from "@otterdeploy/shared/custom-directives-reach";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vite-plus/test";
import { parse as parseYaml } from "yaml";
import * as z from "zod";

import type { ProxyRouteInput } from "../builder";

import { PLATFORM } from "../../constants";
import { adaptedReachError } from "../directive-reach";
import { reconcileRoutes } from "../reconciler";

function rejection(text: string): string | null {
  const parsed = customDirectivesSchema.safeParse(text);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "rejected");
}

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

const composeFileSchema = z.object({
  name: z.string().optional(),
  services: z.record(z.string(), z.object({ container_name: z.string().optional() }).loose()),
});

/** Every name a compose file gives a platform container on the shared network:
 *  the service key (a DNS alias), its container_name, or compose's default
 *  `<project>-<service>-1`. */
function composeHostnames(file: string): string[] {
  const compose = composeFileSchema.parse(
    parseYaml(readFileSync(resolve(repositoryRoot, file), "utf8")),
  );
  const project = compose.name ?? "otterdeploy";
  return Object.entries(compose.services).flatMap(([key, service]) => [
    key,
    service.container_name ?? `${project}-${key}-1`,
  ]);
}

describe("the platform list is the platform the installer runs", () => {
  it.each(["docker-compose.yml", "docker-compose.prod.yml"])(
    "every service and container in %s is refused as an upstream",
    (file) => {
      const hosts = composeHostnames(file);
      expect(hosts.length).toBeGreaterThan(4);
      for (const host of hosts) {
        expect(upstreamReachError(`${host}:80`), host).toMatch(/otterdeploy's own/);
      }
    },
  );

  it("the containers the control plane and builder create at runtime are refused", () => {
    for (const host of [
      PLATFORM.swarm.caddyContainer,
      `${PLATFORM.swarm.caddyContainer}-node`,
      "otterdeploy-health-agent",
      "buildx_buildkit_otterdeploy-cache0",
      "otterdeploy-server-2",
    ]) {
      expect(upstreamReachError(`${host}:80`), host).toMatch(/otterdeploy's own/);
    }
  });
});

describe("the write schema refuses the platform's own services", () => {
  it.each([
    ["the job queue's redis", "reverse_proxy redis:6379"],
    ["the control plane's postgres", "reverse_proxy postgres:5432"],
    ["the control plane", "reverse_proxy server:3000"],
    ["the crowdsec LAPI", "reverse_proxy crowdsec:8080"],
    ["the builder", "reverse_proxy http://builder:80"],
    ["a container_name", "reverse_proxy otterdeploy-redis:6379"],
    ["a compose default container name", "reverse_proxy otterdeploy-server-1:3000"],
    ["buildkitd", "reverse_proxy buildx_buildkit_otterdeploy-cache0:1234"],
    ["the Docker host", "reverse_proxy host.docker.internal:3000"],
    ["the Docker gateway", "reverse_proxy gateway.docker.internal:80"],
    ["a network-qualified name", "reverse_proxy redis.otterdeploy:6379"],
    ["swarm's task list", "reverse_proxy tasks.server:3000"],
    ["a swarm task container", "reverse_proxy server.1.abcdefghijklmnopqrstuvwxy:3000"],
    ["upper case and a root dot", "reverse_proxy REDIS.:6379"],
    ["a `to` subdirective", "reverse_proxy {\n\tto od-shop-api:80 server:3000\n}"],
    ["php_fastcgi", "php_fastcgi postgres:9000"],
    ["forward_auth", "forward_auth server:3000 {\n\turi /api/auth\n}"],
    ["a dynamic a source", "reverse_proxy {\n\tdynamic a redis 6379\n}"],
    [
      "a dynamic block's name",
      "reverse_proxy {\n\tdynamic a {\n\t\tname crowdsec\n\t\tport 8080\n\t}\n}",
    ],
    [
      "an active health check upstream",
      "reverse_proxy od-shop-api:80 {\n\thealth_upstream redis:6379\n}",
    ],
    [
      "a transport's forward proxy",
      "reverse_proxy od-shop-api:80 {\n\ttransport http {\n\t\tforward_proxy_url http://u:p@server:3000\n\t}\n}",
    ],
    ["a log shipped over the network", "log {\n\toutput net redis:6379\n}"],
    [
      "a tls certificate fetched over http",
      "tls {\n\tget_certificate http http://server:3000/x\n}",
    ],
    ["the cloud metadata address", "reverse_proxy 169.254.169.254:80"],
    ["an IPv6 link-local address", "reverse_proxy [fe80::1]:80"],
  ])("%s is rejected with a reason", (_label, text) => {
    expect(rejection(text)).toMatch(/route directives/);
  });

  it.each([
    ["a public name that shares a platform label", "reverse_proxy redis.example.com:6379"],
    ["a public https upstream", "reverse_proxy https://server.example.com"],
    ["a project service", "reverse_proxy /api/* od-shop-api:8080"],
    ["a public log sink", "log {\n\toutput net logs.example.com:514\n}"],
    [
      "a dynamic block with a refresh interval",
      "reverse_proxy {\n\tdynamic a {\n\t\tname api.example.com\n\t\tport 443\n\t\trefresh 1m\n\t}\n}",
    ],
  ])("%s is still accepted", (_label, text) => {
    expect(rejection(text)).toBeNull();
  });
});

describe("the same rules on Caddy's adapted JSON", () => {
  const site = (handle: unknown[]) => ({
    apps: { http: { servers: { srv0: { routes: [{ handle }] } } } },
  });

  it("rejects a reverse_proxy that dials a platform service", () => {
    const json = site([{ handler: "reverse_proxy", upstreams: [{ dial: "redis:6379" }] }]);
    expect(adaptedReachError(json)).toMatch(/otterdeploy's own "redis"/);
  });

  it("rejects an active health check aimed at a platform service", () => {
    const json = site([
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: "od-shop-api:80" }],
        health_checks: { active: { upstream: "server:3000" } },
      },
    ]);
    expect(adaptedReachError(json)).toMatch(/otterdeploy's own "server"/);
  });

  it("rejects a transport forward proxy through the Docker host", () => {
    const json = site([
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: "od-shop-api:80" }],
        transport: { protocol: "http", forward_proxy_url: "http://host.docker.internal:3000" },
      },
    ]);
    expect(adaptedReachError(json)).toMatch(/Docker host/);
  });

  it("rejects a net log writer, an http certificate manager and an ACME directory inward", () => {
    expect(
      adaptedReachError({
        logging: { logs: { a: { writer: { output: "net", address: "redis:6379" } } } },
      }),
    ).toMatch(/redis/);
    expect(
      adaptedReachError({ get_certificate: [{ via: "http", url: "http://server:3000/c" }] }),
    ).toMatch(/server/);
    expect(
      adaptedReachError({ issuers: [{ module: "acme", ca: "http://crowdsec:8080/dir" }] }),
    ).toMatch(/crowdsec/);
  });

  it("accepts a project service and a public sink", () => {
    const json = site([
      { handler: "reverse_proxy", upstreams: [{ dial: "od-shop-api:8080" }] },
      { writer: { output: "net", address: "logs.example.com:514" } },
    ]);
    expect(adaptedReachError(json)).toBeNull();
  });
});

describe("the metrics directive is recognized wherever it is written", () => {
  it.each([
    ["at site level", "metrics /metrics"],
    ["inside a handle block", "handle /internal/* {\n\tmetrics\n}"],
    ["with options", "metrics /m {\n\tdisable_openmetrics\n}"],
  ])("%s", (_label, text) => {
    expect(hasMetricsDirective(text)).toBe(true);
  });

  it("a header or path that only mentions metrics is not the directive", () => {
    expect(hasMetricsDirective('header X-Metrics "on"\nrewrite /metrics /stats')).toBe(false);
  });
});

describe("the reconciler judges the operator's text, not the generated config", () => {
  const route: ProxyRouteInput = {
    projectId: "project_shop",
    type: "http",
    domain: "shop.example.com",
    upstreamHost: "od-shop-web",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    usesAcme: false,
    protected: true,
    customDirectives: 'header X-Robots-Tag "noindex"',
    customCert: {
      certPath: "/etc/caddy/certs/c1/cert.pem",
      keyPath: "/etc/caddy/certs/c1/key.pem",
    },
  };
  // What /adapt makes of a protected route with an uploaded cert and edge
  // logs: forward_auth and the reserved path dial the control plane, the log
  // streams to its sink, the cert loads from /etc/caddy/certs.
  const generatedJson = (extra: unknown[] = []) => ({
    apps: {
      tls: {
        certificates: {
          load_files: [{ certificate: route.customCert?.certPath, key: route.customCert?.keyPath }],
        },
      },
      http: {
        servers: {
          srv0: {
            routes: [
              {
                handle: [
                  { handler: "reverse_proxy", upstreams: [{ dial: "server:3000" }] },
                  { handler: "reverse_proxy", upstreams: [{ dial: "od-shop-web:3000" }] },
                  ...extra,
                ],
              },
            ],
          },
        },
      },
    },
    logging: { logs: { log0: { writer: { output: "net", address: "server:9100" } } } },
  });

  function reconcileWith(json: unknown) {
    return reconcileRoutes({
      routes: [route],
      adminBind: "unix//run/caddy-admin/admin.sock|0600",
      authzUpstream: "server:3000",
      edgeLogSink: "server:9100",
      adapt: vi.fn(() => Promise.resolve({ ok: true as const, json })),
      load: vi.fn(() => Promise.resolve({ ok: true as const })),
    });
  }

  it("a project with raw directives is not skipped for the platform dials the generator emits", async () => {
    const result = await reconcileWith(generatedJson());
    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(["project_shop"]);
  });

  it("a platform dial that is not the generator's is still caught", async () => {
    const hostile = { handler: "reverse_proxy", upstreams: [{ dial: "redis:6379" }] };
    const result = await reconcileWith(generatedJson([hostile]));
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      { projectId: "project_shop", error: expect.stringMatching(/otterdeploy's own "redis"/) },
    ]);
  });
});
