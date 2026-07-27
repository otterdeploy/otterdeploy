import { describe, expect, it } from "vite-plus/test";

import { privateHostFor } from "../index";
import { clampTtl, NetbirdClient, normalizeManagementUrl, resolvePeerDomain } from "../netbird";
import { MeshProviderError } from "../types";

/** Minimal fetch stub: returns a queued response per call, recording requests. */

/**
 * Index into a fixture array, failing loudly when the element is missing.
 *
 * Replaces `calls[0]!` — a bare non-null assertion turns "the code under test
 * made fewer requests than expected" into "cannot read properties of
 * undefined", which names the symptom and hides the cause. This names the
 * cause.
 */
function at<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected ${what}[${index}] to exist, but only ${items.length} were recorded`);
  }
  return item;
}

function stubFetch(responses: Array<{ status?: number; body?: unknown; text?: string }>): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const spec = at(responses, Math.min(i++, responses.length - 1), "responses");
    const status = spec.status ?? 200;
    const text = spec.text ?? (spec.body === undefined ? "" : JSON.stringify(spec.body));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("normalizeManagementUrl", () => {
  it("accepts a bare host, a trailing slash, and a pasted /api suffix alike", () => {
    expect(normalizeManagementUrl("https://api.netbird.io")).toBe("https://api.netbird.io");
    expect(normalizeManagementUrl("https://api.netbird.io/")).toBe("https://api.netbird.io");
    expect(normalizeManagementUrl("https://nb.example.com/api")).toBe("https://nb.example.com");
    expect(normalizeManagementUrl("  https://nb.example.com/api/  ")).toBe(
      "https://nb.example.com",
    );
  });
});

describe("auth header", () => {
  it("uses the Token scheme, not Bearer", async () => {
    // NetBird PATs are rejected with `Bearer`; this is the single easiest
    // detail to get wrong in the whole client.
    const { impl, calls } = stubFetch([{ body: [{ id: "acc" }] }, { body: [] }]);
    await new NetbirdClient({
      managementUrl: "https://api.netbird.io",
      token: "pat_abc",
      fetchImpl: impl,
    }).verify();

    const headers = at(calls, 0, "calls").init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Token pat_abc");
    expect(at(calls, 0, "calls").url).toBe("https://api.netbird.io/api/accounts");
  });
});

describe("resolvePeerDomain", () => {
  it("prefers the account's configured dns_domain", () => {
    expect(
      resolvePeerDomain({ id: "a", settings: { dns_domain: "corp.internal" } }, [
        { id: "p", dns_label: "host.netbird.cloud" },
      ]),
    ).toEqual({ domain: "corp.internal", source: "account-settings" });
  });

  it("falls back to the zone observed on a real peer", () => {
    // Self-hosted deployments commonly leave dns_domain unset while using a
    // non-default zone — an assumed netbird.cloud would break every hostname.
    expect(
      resolvePeerDomain({ id: "a" }, [{ id: "p", dns_label: "host.netbird.selfhosted" }]),
    ).toEqual({ domain: "netbird.selfhosted", source: "peer-dns-label" });
  });

  it("only guesses when there is no evidence at all, and says so", () => {
    expect(resolvePeerDomain({ id: "a" }, [])).toEqual({
      domain: "netbird.cloud",
      source: "default",
    });
  });

  it("ignores an unqualified dns_label rather than deriving a bogus zone", () => {
    expect(resolvePeerDomain({ id: "a" }, [{ id: "p", dns_label: "host" }])).toEqual({
      domain: "netbird.cloud",
      source: "default",
    });
  });
});

describe("mintNodeKey", () => {
  it("always allows extra DNS labels and stays one-off + ephemeral", async () => {
    const { impl, calls } = stubFetch([{ body: { id: "k1", key: "SECRET", expires: null } }]);
    const client = new NetbirdClient({
      managementUrl: "https://api.netbird.io",
      token: "t",
      fetchImpl: impl,
    });

    await client.mintNodeKey({
      name: "node-1",
      groupIds: ["g1"],
      allowExtraDnsLabels: true,
      ephemeral: true,
    });

    const body = JSON.parse(at(calls, 0, "calls").init.body as string);
    // Without allow_extra_dns_labels the management server rejects the
    // wildcard label at registration and private hostnames never resolve.
    expect(body.allow_extra_dns_labels).toBe(true);
    expect(body.type).toBe("one-off");
    expect(body.usage_limit).toBe(1);
    expect(body.auto_groups).toEqual(["g1"]);
  });
});

describe("clampTtl", () => {
  it("holds NetBird's documented 1-day..1-year bounds", () => {
    expect(clampTtl(undefined)).toBe(86_400);
    expect(clampTtl(60)).toBe(86_400);
    expect(clampTtl(99_999_999)).toBe(31_536_000);
    expect(clampTtl(3_600 * 48)).toBe(172_800);
  });
});

describe("error classification", () => {
  it("reports an unreachable management server as reachability, not bad credentials", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = new NetbirdClient({
      managementUrl: "https://nb.example.com",
      token: "t",
      fetchImpl: impl,
    });

    const error = await client.verify().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MeshProviderError);
    const meshError = error as MeshProviderError;
    // status null => "we never got a response". Calling this an auth failure
    // sends the operator to regenerate a token that was never the problem.
    expect(meshError.status).toBeNull();
    expect(meshError.isAuthFailure).toBe(false);
    expect(meshError.message).toContain("Could not reach");
  });

  it("flags 401 and 403 as auth failures", async () => {
    for (const status of [401, 403]) {
      const { impl } = stubFetch([{ status, text: "" }]);
      const error = (await new NetbirdClient({
        managementUrl: "https://api.netbird.io",
        token: "t",
        fetchImpl: impl,
      })
        .verify()
        .catch((e: unknown) => e)) as MeshProviderError;
      expect(error.isAuthFailure).toBe(true);
    }
  });
});

describe("removePeer", () => {
  it("treats an already-deleted peer as success", async () => {
    // Teardown must be idempotent: a retried server delete shouldn't fail
    // because the peer is already gone — that IS the desired end state.
    const { impl } = stubFetch([{ status: 404, text: "" }]);
    await expect(
      new NetbirdClient({
        managementUrl: "https://api.netbird.io",
        token: "t",
        fetchImpl: impl,
      }).removePeer("gone"),
    ).resolves.toBeUndefined();
  });

  it("still surfaces a real failure", async () => {
    const { impl } = stubFetch([{ status: 500, text: "boom" }]);
    await expect(
      new NetbirdClient({
        managementUrl: "https://api.netbird.io",
        token: "t",
        fetchImpl: impl,
      }).removePeer("p1"),
    ).rejects.toBeInstanceOf(MeshProviderError);
  });
});

describe("ensureAccessPolicy", () => {
  it("writes NO policy when no source group is chosen", async () => {
    // NetBird is zero-trust by default. Inventing a permissive policy because
    // the operator hasn't picked groups yet would silently widen access.
    const { impl, calls } = stubFetch([{ body: [] }]);
    await new NetbirdClient({
      managementUrl: "https://api.netbird.io",
      token: "t",
      fetchImpl: impl,
    }).ensureAccessPolicy({
      name: "otterdeploy-private-services",
      sourceGroupIds: [],
      destinationGroupIds: ["nodes"],
      ports: ["443"],
    });
    expect(calls).toHaveLength(0);
  });

  it("updates the existing managed policy instead of creating duplicates", async () => {
    const { impl, calls } = stubFetch([
      { body: [{ id: "pol1", name: "otterdeploy-private-services" }] },
      { body: {} },
    ]);
    await new NetbirdClient({
      managementUrl: "https://api.netbird.io",
      token: "t",
      fetchImpl: impl,
    }).ensureAccessPolicy({
      name: "otterdeploy-private-services",
      sourceGroupIds: ["team"],
      destinationGroupIds: ["nodes"],
      ports: ["443"],
    });
    expect(at(calls, 1, "calls").init.method).toBe("PUT");
    expect(at(calls, 1, "calls").url).toContain("/api/policies/pol1");
  });
});

describe("privateHostFor", () => {
  it("builds a host under the node's wildcard label", () => {
    expect(
      privateHostFor({
        provider: "netbird",
        serviceSlug: "api",
        projectSlug: "storefront",
        dnsLabel: "od",
        peerDomain: "netbird.cloud",
      }),
    ).toBe("api-storefront.od.netbird.cloud");
  });
});
