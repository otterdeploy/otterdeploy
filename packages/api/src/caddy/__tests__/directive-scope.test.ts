/**
 * The project-aware reach rules for raw route directives.
 *
 * The write schema cannot know whose service a Docker name is, or where a DNS
 * name points; parseRouteDirectives decides both at save time, against the
 * route's own project. The resolver is injected, so nothing here touches DNS.
 */
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DIRECTIVE_LOOKUP_TIMEOUT_MS,
  MAX_DIRECTIVE_LOOKUPS,
  parseRouteDirectives,
  type RouteDirectiveScope,
} from "../directive-scope";

function scope(overrides: Partial<RouteDirectiveScope> = {}): RouteDirectiveScope {
  return {
    own: {
      bases: new Set([
        "od-shop-api",
        "od-shop-web",
        "otterdeploy-pg-shop-db",
        "db.shop.otterdeploy.internal",
      ]),
      environments: new Set(["staging"]),
    },
    allowAddresses: [],
    denyAddresses: ["203.0.113.50"],
    denyHosts: ["deploy.example.com"],
    lookup: vi.fn(() => Promise.resolve(["93.184.216.34"])),
    lookupTimeoutMs: 50,
    ...overrides,
  };
}

async function refusal(text: string, s = scope()): Promise<string | null> {
  const result = await parseRouteDirectives(text, s);
  return result.isErr() ? result.error.message : null;
}

describe("a Docker name must be the project's own service", () => {
  it.each([
    ["another project's service", "reverse_proxy od-other-api:80"],
    ["another project's database", "reverse_proxy otterdeploy-pg-other-db:5432"],
    ["another project's database alias", "reverse_proxy db.other.otterdeploy.internal:5432"],
    ["a short alias (ambiguous across networks)", "reverse_proxy api:3000"],
    ["a container id", "reverse_proxy 4f1c2a9b7d3e:80"],
    ["another project's service via tasks.", "reverse_proxy tasks.od-other-api:80"],
    ["another project's network-qualified name", "reverse_proxy od-other-api.otterdeploy-other:80"],
    ["a dynamic source", "reverse_proxy {\n\tdynamic a od-other-api 80\n}"],
  ])("%s is refused", async (_label, text) => {
    const result = await parseRouteDirectives(text, scope());
    expect(result.isErr() && result.error).toMatchObject({
      _tag: "DirectiveReachError",
      message: expect.stringMatching(/not one of this project's services/),
    });
  });

  it.each([
    ["its own service", "reverse_proxy /api/* od-shop-api:8080"],
    ["its own service in an environment", "reverse_proxy od-shop-api-staging:8080"],
    ["its own service in a preview", "reverse_proxy od-shop-api-pr-12:8080"],
    ["its own database", "reverse_proxy otterdeploy-pg-shop-db:5432"],
    ["its own database alias", "reverse_proxy db.shop.otterdeploy.internal:5432"],
    ["a `to` list of its own services", "reverse_proxy {\n\tto od-shop-api:80 od-shop-web:80\n}"],
  ])("%s is accepted", async (_label, text) => {
    expect(await refusal(text)).toBeNull();
  });

  it("an unknown environment suffix is not the project's", async () => {
    expect(await refusal("reverse_proxy od-shop-api-prod:80")).toMatch(/not one of this project's/);
  });
});

describe("addresses go through the egress policy", () => {
  it.each([
    ["an RFC1918 address on the shared network", "reverse_proxy 172.18.0.3:6379"],
    ["a swarm overlay address", "reverse_proxy 10.0.1.5:80"],
    ["a CGNAT address", "reverse_proxy 100.100.1.1:80"],
    ["an IPv6 unique-local address", "reverse_proxy [fd00::5]:80"],
  ])("%s is refused", async (_label, text) => {
    expect(await refusal(text)).toMatch(/private or internal address/);
  });

  it("an operator-allowlisted LAN address is accepted", async () => {
    const lan = scope({ allowAddresses: ["192.168.1.0/24"] });
    expect(await refusal("reverse_proxy 192.168.1.10:8123", lan)).toBeNull();
  });

  it("the control plane's own address stays refused even when allowlisted", async () => {
    const lan = scope({ allowAddresses: ["203.0.113.0/24"] });
    expect(await refusal("reverse_proxy 203.0.113.50:3000", lan)).toMatch(/private or internal/);
    expect(await refusal("reverse_proxy https://deploy.example.com")).toMatch(
      /control plane's own/,
    );
  });

  it("a public address is accepted", async () => {
    expect(await refusal("reverse_proxy 93.184.216.34:443")).toBeNull();
  });
});

describe("public names are resolved once, with a bounded wait", () => {
  it("a wildcard-DNS name that resolves to loopback is refused", async () => {
    const lookup = vi.fn(() => Promise.resolve(["127.0.0.1"]));
    const text = "reverse_proxy 127.0.0.1.nip.io:8080";
    expect(await refusal(text, scope({ lookup }))).toMatch(/resolves to 127\.0\.0\.1/);
    expect(lookup).toHaveBeenCalledWith("127.0.0.1.nip.io");
  });

  it("a name whose answer mixes public and private addresses is refused", async () => {
    const lookup = vi.fn(() => Promise.resolve(["93.184.216.34", "10.0.0.7"]));
    expect(await refusal("reverse_proxy api.example.com", scope({ lookup }))).toMatch(
      /10\.0\.0\.7/,
    );
  });

  it("a name resolving to an allowlisted LAN address is accepted", async () => {
    const lookup = vi.fn(() => Promise.resolve(["192.168.1.10"]));
    const lan = scope({ lookup, allowAddresses: ["192.168.1.10"] });
    expect(await refusal("reverse_proxy nas.home.example:443", lan)).toBeNull();
  });

  it("a public name is accepted", async () => {
    expect(await refusal("reverse_proxy https://api.example.com")).toBeNull();
  });

  it("a name that does not resolve is accepted: the edge reports it, not the save", async () => {
    const lookup = vi.fn(() => Promise.reject(new Error("ENOTFOUND")));
    expect(await refusal("reverse_proxy nowhere.example:80", scope({ lookup }))).toBeNull();
  });

  it("a resolver that never answers is abandoned after the timeout, not waited on", async () => {
    const lookup = vi.fn(() => new Promise<string[]>(() => undefined));
    const started = performance.now();
    expect(await refusal("reverse_proxy slow.example:80", scope({ lookup }))).toBeNull();
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("without an explicit bound a save waits DIRECTIVE_LOOKUP_TIMEOUT_MS on DNS, then moves on", async () => {
    vi.useFakeTimers();
    try {
      const lookup = vi.fn(() => new Promise<string[]>(() => undefined));
      let settled = false;
      const pending = parseRouteDirectives("reverse_proxy slow.example:80", {
        ...scope({ lookup }),
        lookupTimeoutMs: undefined,
      }).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(DIRECTIVE_LOOKUP_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).isOk()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a save resolves its public names together, so its wait does not grow with the count", async () => {
    const lookup = vi.fn(() => new Promise<string[]>(() => undefined));
    const text = Array.from(
      { length: MAX_DIRECTIVE_LOOKUPS },
      (_, i) => `reverse_proxy /p${i}/* a${i}.example:80`,
    ).join("\n");
    const started = performance.now();
    expect(await refusal(text, scope({ lookup, lookupTimeoutMs: 100 }))).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(MAX_DIRECTIVE_LOOKUPS);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("more distinct public names than one save may resolve is refused before any lookup", async () => {
    const lookup = vi.fn(() => Promise.resolve(["93.184.216.34"]));
    const text = Array.from(
      { length: MAX_DIRECTIVE_LOOKUPS + 1 },
      (_, i) => `reverse_proxy /p${i}/* a${i}.example:80`,
    ).join("\n");
    expect(await refusal(text, scope({ lookup }))).toMatch(/at most 16 distinct public upstream/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a name repeated across directives is resolved once", async () => {
    const lookup = vi.fn(() => Promise.resolve(["93.184.216.34"]));
    const text =
      "reverse_proxy /a/* api.example.com\nreverse_proxy /b/* https://api.example.com:443";
    expect(await refusal(text, scope({ lookup }))).toBeNull();
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("Docker names and IP literals are never sent to DNS", async () => {
    const lookup = vi.fn(() => Promise.resolve(["127.0.0.1"]));
    await refusal(
      "reverse_proxy od-shop-api:80\nreverse_proxy 93.184.216.34:80",
      scope({ lookup }),
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});
