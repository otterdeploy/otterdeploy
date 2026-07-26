import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Unlike github-app-repos.test.ts / github-app-writeback.test.ts (which mock
// @otterdeploy/shared/egress-policy entirely to keep those tests focused on
// URL/method/body wiring), this file deliberately does NOT mock it — it
// proves `ghFetch` (the wrapper od-skk routed routers/git/inspect.ts and
// inspect-github.ts's tenant-facing fetches through) fails closed for real
// against loopback, cloud metadata, RFC1918, and a hostname that resolves to
// a private address, exercising the actual validate → resolve → deny chain
// in packages/shared/src/egress-policy.ts. Only the DB read
// (controlPlaneEgressDenylist) and the DNS resolver are stubbed, so this
// still runs as a pure unit test without a real network or database.
vi.mock("../lib/egress-denylist", () => ({
  controlPlaneEgressDenylist: vi
    .fn()
    .mockResolvedValue({ blockedHosts: [], blockedAddresses: [] }),
}));
vi.mock("../lib/egress-options", () => ({
  egressAllowlist: () => [],
}));

const dnsLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]): unknown => dnsLookup(...args),
}));

import { ghFetch } from "./github-app";

describe("ghFetch → real (unmocked) fail-closed egress policy", () => {
  beforeEach(() => {
    dnsLookup.mockReset();
  });

  it.each([
    ["loopback", "https://127.0.0.1/app/installations/1/access_tokens"],
    ["cloud metadata (169.254.169.254)", "https://169.254.169.254/latest/meta-data/"],
    ["RFC1918", "https://10.0.0.5/app/installations/1/access_tokens"],
  ])("denies an IP-literal %s target with the policy's clear error", async (_label, url) => {
    await expect(ghFetch(url)).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/i,
    );
    // IP literals are recognized by net.isIP before any DNS lookup happens —
    // this proves the denial is real (address-range check), not an artifact
    // of a stubbed resolver.
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it("denies a hostname that resolves to a private address (DNS-rebinding shape)", async () => {
    dnsLookup.mockResolvedValue([{ address: "192.168.1.50", family: 4 }]);

    await expect(ghFetch("https://internal.attacker.test/x")).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/i,
    );
    expect(dnsLookup).toHaveBeenCalled();
  });

  it("denies a mixed public/private DNS answer (fails closed, not first-address-wins)", async () => {
    dnsLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(ghFetch("https://mixed.attacker.test/x")).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/i,
    );
  });

  it("rejects a plain-http target — these call sites stay https-only", async () => {
    await expect(ghFetch("http://api.github.com/x")).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/i,
    );
    expect(dnsLookup).not.toHaveBeenCalled();
  });
});
