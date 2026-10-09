/**
 * The secret-provider client goes through the product's outbound egress
 * policy (packages/shared/src/egress-policy.ts), unmocked here: loopback,
 * private and cloud-metadata addresses are refused unless the operator put
 * the address on the egress allowlist, and every redirect hop is re-checked.
 * Only the DB-backed denylist / allowlist reads and the DNS resolver are
 * stubbed, so this runs without a database or network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { VaultProviderRuntime } from "./types";

const allowlist: string[] = [];
vi.mock("../egress-options", () => ({ egressAllowlist: () => Promise.resolve([...allowlist]) }));
vi.mock("../egress-denylist", () => ({
  controlPlaneEgressDenylist: () => Promise.resolve({ blockedHosts: [], blockedAddresses: [] }),
}));
const dnsLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]): unknown => dnsLookup(...args),
}));

import { hashicorpGetSecrets } from "./hashicorp";

/** A Vault-shaped server on loopback. */
let requests: string[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname);
      if (url.pathname === "/v1/secret/data/hop") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return Response.json({ data: { data: { password: "internal-secret" } } });
    },
  });
});
afterAll(async () => {
  await server.stop(true);
});
beforeEach(() => {
  requests = [];
  allowlist.length = 0;
  dnsLookup.mockReset();
});

function provider(url: string): VaultProviderRuntime {
  return { name: "hv", kind: "hashicorp", config: { url, mount: "secret" }, credential: "hvs.t" };
}

describe("secret providers go through the outbound egress policy", () => {
  it.each([
    ["loopback", () => `http://127.0.0.1:${server.port}`],
    ["cloud metadata", () => "http://169.254.169.254"],
    ["RFC1918", () => "https://10.0.0.5:8200"],
  ])("refuses a %s provider URL before connecting", async (_label, url) => {
    await expect(hashicorpGetSecrets(provider(url()), ["app/db:password"])).rejects.toThrow(
      /secret provider "hv": request failed \(blocked by the outbound egress policy/,
    );
    expect(requests).toEqual([]);
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to a private address", async () => {
    dnsLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      hashicorpGetSecrets(provider(`http://vault.internal.test:${server.port}`), [
        "app/db:password",
      ]),
    ).rejects.toThrow(/blocked by the outbound egress policy/);
    expect(dnsLookup).toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("reaches a private Vault the operator put on the egress allowlist", async () => {
    allowlist.push("127.0.0.1");
    const out = await hashicorpGetSecrets(provider(`http://127.0.0.1:${server.port}`), [
      "app/db:password",
    ]);
    expect(out.get("app/db:password")).toBe("internal-secret");
    expect(requests).toEqual(["/v1/secret/data/app/db"]);
  });

  it("re-checks every redirect hop: an allowed Vault cannot bounce to the metadata service", async () => {
    allowlist.push("127.0.0.1");
    await expect(
      hashicorpGetSecrets(provider(`http://127.0.0.1:${server.port}`), ["hop:password"]),
    ).rejects.toThrow(/blocked by the outbound egress policy/);
    expect(requests).toEqual(["/v1/secret/data/hop"]);
  });
});
