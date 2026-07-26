import type { LookupAddress } from "node:dns";

import { describe, expect, mock, test } from "bun:test";

import {
  assertAllowedEgressUrl,
  EgressPolicyError,
  egressFetch,
  isForbiddenEgressAddress,
  resolveEgressAddresses,
} from "../egress-policy";

describe("isForbiddenEgressAddress", () => {
  test.each([
    // loopback, in every notation a tenant could type or a DNS answer could carry
    "127.0.0.1",
    "127.1",
    "0.0.0.0",
    "::1",
    // decimal-encoded 127.0.0.1
    "2130706433",
    // hex-octet-encoded 127.0.0.1
    "0x7f.1",
    // cloud metadata
    "169.254.169.254",
    "169.254.0.1",
    // RFC1918 private ranges
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    // CGNAT
    "100.64.0.1",
    // IPv6 unique-local (docker/swarm overlay range)
    "fc00::1",
    "fd12:3456:789a::1",
    // IPv6 link-local
    "fe80::1",
    // IPv4-mapped IPv6, both notations
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    // multicast / reserved / documentation ranges
    "224.0.0.1",
    "240.0.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "2001:db8::1",
    "ff02::1",
    // "127.1" / "0x7f.1" / "2130706433" aren't valid `net.isIP` literals on
    // their own (that encoding is a URL-host-parser normalization, exercised
    // in the assertAllowedEgressUrl tests below) — here they hit the
    // fail-closed "not a recognized IP literal" branch, which is exactly the
    // safe outcome for an unrecognized address form.
  ])("denies %s", (address) => {
    expect(isForbiddenEgressAddress(address)).toBe(true);
  });

  test.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])(
    "allows globally routable address %s",
    (address) => {
      expect(isForbiddenEgressAddress(address)).toBe(false);
    },
  );

  test("denies control-plane's own address even when explicitly allowlisted", () => {
    expect(
      isForbiddenEgressAddress("192.168.1.50", {
        denyAddresses: ["192.168.1.50"],
        allowAddresses: ["192.168.1.0/24"],
      }),
    ).toBe(true);
  });

  test("operator allowlist carves out a private target not otherwise denied", () => {
    expect(isForbiddenEgressAddress("192.168.1.50")).toBe(true);
    expect(isForbiddenEgressAddress("192.168.1.50", { allowAddresses: ["192.168.1.50"] })).toBe(
      false,
    );
    expect(isForbiddenEgressAddress("192.168.1.99", { allowAddresses: ["192.168.1.0/24"] })).toBe(
      false,
    );
    // A CIDR carve-out is scoped — a sibling address outside it stays denied.
    expect(isForbiddenEgressAddress("192.168.2.1", { allowAddresses: ["192.168.1.0/24"] })).toBe(
      true,
    );
  });

  test("garbage allowlist entries are ignored rather than throwing", () => {
    expect(
      isForbiddenEgressAddress("192.168.1.50", { allowAddresses: ["not-an-ip", "10.0.0.0/999"] }),
    ).toBe(true);
  });

  test("a non-IP-literal input fails closed", () => {
    expect(isForbiddenEgressAddress("example.com")).toBe(true);
  });
});

describe("assertAllowedEgressUrl", () => {
  test("normalizes every encoded IPv4 form to the canonical dotted form", () => {
    for (const url of ["http://127.1/", "http://0x7f.1/", "http://2130706433/", "http://017700000001/"]) {
      expect(assertAllowedEgressUrl(url, { allowHttp: true }).hostname).toBe("127.0.0.1");
    }
  });

  test("rejects non-http(s) schemes outright", () => {
    expect(() => assertAllowedEgressUrl("file:///etc/passwd")).toThrow(EgressPolicyError);
    expect(() => assertAllowedEgressUrl("gopher://example.com/")).toThrow("Only HTTPS");
    expect(() => assertAllowedEgressUrl("dict://example.com/")).toThrow(EgressPolicyError);
  });

  test("denies http unless the caller opts in", () => {
    expect(() => assertAllowedEgressUrl("http://example.com/")).toThrow("Only HTTPS");
    expect(assertAllowedEgressUrl("http://example.com/", { allowHttp: true }).protocol).toBe(
      "http:",
    );
  });

  test("rejects embedded credentials", () => {
    expect(() => assertAllowedEgressUrl("https://user:pass@example.com/")).toThrow("Credentials");
  });

  test("rejects a hostname on the control-plane deny list", () => {
    expect(() =>
      assertAllowedEgressUrl("https://deploy.example/hook", { denyHosts: ["deploy.example"] }),
    ).toThrow("control plane");
    // trailing dot / case-insensitive
    expect(() =>
      assertAllowedEgressUrl("https://Deploy.Example./hook", { denyHosts: ["deploy.example"] }),
    ).toThrow("control plane");
  });

  test("rejects an unparsable URL", () => {
    expect(() => assertAllowedEgressUrl("not a url")).toThrow("invalid");
  });
});

describe("resolveEgressAddresses", () => {
  const forbidden = new Set(["private.internal", "metadata.internal"]);
  const answers: Record<string, LookupAddress[]> = {
    "public.example": [{ address: "93.184.216.34", family: 4 }],
    "private.internal": [{ address: "10.1.2.3", family: 4 }],
    "metadata.internal": [{ address: "169.254.169.254", family: 4 }],
    "rebind.example": [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ],
    "empty.example": [],
  };
  const resolveHost = mock((hostname: string) => Promise.resolve(answers[hostname] ?? []));

  test("resolves a DNS name to a private address and rejects it", async () => {
    const url = assertAllowedEgressUrl("https://private.internal/");
    await expect(resolveEgressAddresses(url, {}, resolveHost)).rejects.toThrow("non-public");
  });

  test("rejects a DNS name resolving to the cloud metadata address", async () => {
    const url = assertAllowedEgressUrl("https://metadata.internal/");
    await expect(resolveEgressAddresses(url, {}, resolveHost)).rejects.toThrow("non-public");
    expect(forbidden.has("metadata.internal")).toBe(true);
  });

  test("rejects a mixed public/private DNS answer (rebinding setup) before any address is used", async () => {
    const url = assertAllowedEgressUrl("https://rebind.example/");
    await expect(resolveEgressAddresses(url, {}, resolveHost)).rejects.toThrow("non-public");
  });

  test("allows a hostname that resolves only to public addresses", async () => {
    const url = assertAllowedEgressUrl("https://public.example/");
    await expect(resolveEgressAddresses(url, {}, resolveHost)).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  test("rejects a hostname with no DNS answers", async () => {
    const url = assertAllowedEgressUrl("https://empty.example/");
    await expect(resolveEgressAddresses(url, {}, resolveHost)).rejects.toThrow("no addresses");
  });
});

describe("egressFetch", () => {
  const publicAddress: LookupAddress = { address: "93.184.216.34", family: 4 };

  test("pins the validated address for the socket and re-validates a redirect that pivots to a private target", async () => {
    const resolveHost = mock()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const request = mock().mockResolvedValueOnce({
      status: 302,
      headers: { location: "http://metadata.invalid/latest/meta-data" },
      body: Buffer.alloc(0),
    });

    await expect(
      egressFetch("http://public.example/hook", {}, { allowHttp: true, resolveHost, request }),
    ).rejects.toThrow("non-public");
    // The first (and only) socket dial used the DNS-resolved, policy-checked
    // address — never the raw hostname — proving the connection is pinned.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual(publicAddress);
    // The redirect target was never dialed — it was rejected before a
    // second `request()` call, i.e. before a second socket would open.
  });

  test("follows a redirect to a still-public target and re-resolves it before dialing", async () => {
    const secondAddress: LookupAddress = { address: "104.16.0.1", family: 4 };
    const resolveHost = mock()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([secondAddress]);
    const request = mock()
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: "https://public.example/again" },
        body: Buffer.alloc(0),
      })
      .mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from("ok") });

    const res = await egressFetch("https://public.example/hook", {}, { resolveHost, request });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(resolveHost).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toEqual(secondAddress);
  });

  test("rejects a target whose hostname is on the control-plane deny list without any DNS lookup", async () => {
    const resolveHost = mock(() => Promise.resolve([publicAddress]));
    await expect(
      egressFetch(
        "https://deploy.example/hook",
        {},
        { denyHosts: ["deploy.example"], resolveHost },
      ),
    ).rejects.toThrow("control plane");
    expect(resolveHost).not.toHaveBeenCalled();
  });

  test("bounds DNS resolution by the total request deadline", async () => {
    const resolveHost = mock(() => new Promise<LookupAddress[]>(() => undefined));
    await expect(
      egressFetch("https://slow.example/hook", {}, { timeoutMs: 10, resolveHost }),
    ).rejects.toThrow("timed out");
  });

  test("denies a plain-http target unless allowHttp is set", async () => {
    const resolveHost = mock(() => Promise.resolve([publicAddress]));
    await expect(
      egressFetch("http://public.example/hook", {}, { resolveHost }),
    ).rejects.toThrow("Only HTTPS");
    expect(resolveHost).not.toHaveBeenCalled();
  });
});
