import type { LookupAddress } from "node:dns";

import { describe, expect, test, vi } from "vite-plus/test";

import {
  fetchPublicText,
  isForbiddenOutboundAddress,
  validatePublicHttpUrl,
} from "../public-fetch";

describe("public outbound address policy", () => {
  test.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.100.100.200",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::",
    "::7f00:1",
    "::1",
    "::ffff:127.0.0.1",
    "2001::1",
    "2002:7f00:1::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("rejects non-public address %s", (address) => {
    expect(isForbiddenOutboundAddress(address)).toBe(true);
  });

  test.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows globally routable address %s",
    (address) => {
      expect(isForbiddenOutboundAddress(address)).toBe(false);
    },
  );

  test("rejects explicitly blocked control-plane addresses", () => {
    expect(isForbiddenOutboundAddress("1.2.3.4", ["1.2.3.4"])).toBe(true);
  });
});

describe("public URL policy", () => {
  test("rejects credentials, non-http schemes, and control-plane hosts", () => {
    expect(() => validatePublicHttpUrl("file:///etc/passwd")).toThrow("Only HTTP");
    expect(() => validatePublicHttpUrl("https://user:pass@example.com/list")).toThrow(
      "Credentials",
    );
    expect(() => validatePublicHttpUrl("https://deploy.example/list", ["deploy.example"])).toThrow(
      "control plane",
    );
  });

  test("normalizes encoded IPv4 forms before address validation", () => {
    expect(validatePublicHttpUrl("http://2130706433/list").hostname).toBe("127.0.0.1");
  });
});

describe("fetchPublicText", () => {
  const publicAddress: LookupAddress = { address: "93.184.216.34", family: 4 };

  test("pins a validated address and revalidates a redirect target", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const request = vi.fn().mockResolvedValueOnce({
      status: 302,
      headers: { location: "http://metadata.invalid/latest/meta-data" },
      body: Buffer.alloc(0),
    });

    await expect(
      fetchPublicText("http://public.example/list", {}, { resolve, request, localAddresses: [] }),
    ).rejects.toThrow("non-public");
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toEqual(publicAddress);
  });

  test("rejects mixed public/private DNS answers before opening a socket", async () => {
    const request = vi.fn();
    await expect(
      fetchPublicText(
        "https://rebind.example/list",
        {},
        {
          resolve: async () => [publicAddress, { address: "10.0.0.5", family: 4 }],
          request,
          localAddresses: [],
        },
      ),
    ).rejects.toThrow("non-public");
    expect(request).not.toHaveBeenCalled();
  });

  test("bounds DNS resolution by the total request deadline", async () => {
    await expect(
      fetchPublicText(
        "https://slow.example/list",
        { timeoutMs: 10 },
        {
          resolve: () => new Promise(() => undefined),
          request: vi.fn(),
          localAddresses: [],
        },
      ),
    ).rejects.toThrow("timed out");
  });

  test("enforces redirect count, HTTPS downgrade, status and content type", async () => {
    const resolve = async () => [publicAddress];
    const redirect = vi.fn().mockResolvedValue({
      status: 302,
      headers: { location: "https://public.example/again" },
      body: Buffer.alloc(0),
    });
    await expect(
      fetchPublicText(
        "https://public.example/list",
        { maxRedirects: 1 },
        { resolve, request: redirect, localAddresses: [] },
      ),
    ).rejects.toThrow("Too many redirects");

    await expect(
      fetchPublicText(
        "https://public.example/list",
        {},
        {
          resolve,
          request: async () => ({
            status: 302,
            headers: { location: "http://public.example/list" },
            body: Buffer.alloc(0),
          }),
          localAddresses: [],
        },
      ),
    ).rejects.toThrow("downgrade");

    await expect(
      fetchPublicText(
        "https://public.example/list",
        {},
        {
          resolve,
          request: async () => ({
            status: 200,
            headers: { "content-type": "text/html" },
            body: Buffer.from("<html>login</html>"),
          }),
          localAddresses: [],
        },
      ),
    ).rejects.toThrow("plain-text");
  });
});
