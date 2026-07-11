import { describe, expect, it } from "vite-plus/test";

import { shortUserAgent } from "./edge-logs-ua";

describe("shortUserAgent", () => {
  it("classifies desktop Chrome with OS family", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 130 / macOS");
  });

  it("classifies Firefox on Linux", () => {
    expect(
      shortUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"),
    ).toBe("Firefox 131 / Linux");
  });

  it("classifies mobile Safari via Version/ token, iOS family", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 18 / iOS");
  });

  it("classifies Edge before Chrome (Edge UAs embed Chrome/)", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79",
      ),
    ).toBe("Edge 129 / Windows");
  });

  it("classifies Chrome on Android", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome 130 / Android");
  });

  it("passes CLI tools through with major.minor", () => {
    expect(shortUserAgent("curl/8.7.1")).toBe("curl/8.7");
    expect(shortUserAgent("Wget/1.21.4 (linux-gnu)")).toBe("wget/1.21");
    expect(shortUserAgent("python-requests/2.32.3")).toBe("python-requests/2.32");
    expect(shortUserAgent("Go-http-client/2.0")).toBe("go-http-client/2.0");
    expect(shortUserAgent("node-fetch/3.3.2 (+https://github.com/node-fetch/node-fetch)")).toBe(
      "node-fetch/3.3",
    );
  });

  it("names known bots and webhook agents", () => {
    expect(
      shortUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe("Googlebot");
    expect(shortUserAgent("Stripe/1.0 (+https://stripe.com/docs/webhooks)")).toBe("Stripe");
    expect(shortUserAgent("GitHub-Hookshot/044aadd")).toBe("GitHub hooks");
  });

  it("flags generic crawlers as bot", () => {
    expect(shortUserAgent("Mozilla/5.0 (compatible; SomeUnknownBot/1.0)")).toBe("bot");
  });

  it("falls back to the first product token", () => {
    expect(shortUserAgent("weird-agent/4.2.0 extra stuff here")).toBe("weird-agent/4.2");
  });

  it("truncates unrecognized opaque strings", () => {
    const out = shortUserAgent("some totally unstructured agent string without versions");
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns a dash for empty input", () => {
    expect(shortUserAgent("")).toBe("—");
    expect(shortUserAgent("   ")).toBe("—");
  });
});
