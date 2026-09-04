import { describe, expect, test } from "bun:test";

import { withPreviewNoIndex, withSiteSecurityHeaders } from "./response-policy";

describe("withPreviewNoIndex", () => {
  test("copies a response whose synthetic header guard rejects mutation", async () => {
    class GuardedHeaders extends Headers {
      override set(_name: string, _value: string): void {
        throw new TypeError("immutable");
      }
    }

    const original = new Response("redirect body", {
      status: 307,
      headers: { location: "https://otterdeploy.com/docs" },
    });
    Object.defineProperty(original, "headers", {
      value: new GuardedHeaders(original.headers),
    });

    const response = withPreviewNoIndex(original);

    expect(response).not.toBe(original);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://otterdeploy.com/docs");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(original.headers.get("x-robots-tag")).toBeNull();
    expect(await response.text()).toBe("redirect body");
  });

  test("keeps a mutable SSR response intact so TanStack retains its cleanup metadata", async () => {
    const original = new Response("document", {
      status: 202,
      statusText: "Rendering",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-existing": "preserved",
      },
    });

    const response = withPreviewNoIndex(original);

    expect(response).toBe(original);
    expect(response.body).toBe(original.body);
    expect(response.statusText).toBe("Rendering");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-existing")).toBe("preserved");
    expect(await response.text()).toBe("document");
  });
});

describe("withSiteSecurityHeaders", () => {
  test("hardens a mutable SSR response without replacing it", async () => {
    const original = new Response("document", {
      status: 202,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-existing": "preserved",
      },
    });

    const response = withSiteSecurityHeaders(
      new Request("http://otterdeploy.com/docs", {
        headers: { "x-forwarded-proto": " HTTPS " },
      }),
      original,
    );

    expect(response).toBe(original);
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-existing")).toBe("preserved");
    expect(response.headers.get("content-security-policy")).toBe(
      "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
    expect(response.headers.get("permissions-policy")).not.toContain("clipboard");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(await response.text()).toBe("document");
  });

  test("copies an immutable redirect while preserving its location", () => {
    const original = Response.redirect("https://otterdeploy.com/docs", 301);
    const response = withSiteSecurityHeaders(
      new Request("https://www.otterdeploy.com/docs"),
      original,
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://otterdeploy.com/docs");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  test.each([
    "http://otterdeploy.com/docs",
    "https://preview.otterdeploy.workers.dev/docs",
    "http://localhost:3002/docs",
  ])("does not emit HSTS for %s", (url) => {
    const response = withSiteSecurityHeaders(new Request(url), new Response("document"));

    expect(response.headers.get("strict-transport-security")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
