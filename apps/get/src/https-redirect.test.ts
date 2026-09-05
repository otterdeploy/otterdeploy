import { describe, expect, test } from "bun:test";

import { httpsRedirectFor, publicRedirectFor, withArtifactSecurityHeaders } from "./https-redirect";

describe("httpsRedirectFor", () => {
  test("redirects the public HTTP artifact URL in one permanent hop", () => {
    const response = httpsRedirectFor(
      new Request("http://get.otterdeploy.com/v0.20.0/install.sh?download=1"),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://get.otterdeploy.com/v0.20.0/install.sh?download=1",
    );
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(response?.body).toBeNull();
  });

  test("trusts Cloudflare's forwarded protocol", () => {
    const response = httpsRedirectFor(
      new Request("https://get.otterdeploy.com/install.sh", {
        headers: { "x-forwarded-proto": " HTTP " },
      }),
    );

    expect(response?.headers.get("location")).toBe("https://get.otterdeploy.com/install.sh");
  });

  test("keeps the public location HTTPS when a TLS proxy uses an HTTP request URL", () => {
    const response = httpsRedirectFor(
      new Request("http://get.otterdeploy.com:8080/install.sh", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );

    expect(response?.headers.get("location")).toBe("https://get.otterdeploy.com/install.sh");
  });

  test("removes an alternate port while upgrading to HTTPS", () => {
    const response = httpsRedirectFor(
      new Request("http://get.otterdeploy.com:8080/v0.20.0/install.sh?download=1"),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://get.otterdeploy.com/v0.20.0/install.sh?download=1",
    );
  });

  test("removes one terminal DNS root dot on HTTP and HTTPS", () => {
    for (const protocol of ["http", "https"]) {
      const response = httpsRedirectFor(
        new Request(`${protocol}://get.otterdeploy.com./install.sh`),
      );

      expect(response?.status).toBe(308);
      expect(response?.headers.get("location")).toBe("https://get.otterdeploy.com/install.sh");
    }
  });

  test("preserves unsupported methods across the HTTPS upgrade", () => {
    const response = httpsRedirectFor(
      new Request("http://get.otterdeploy.com/install.sh", { method: "POST" }),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://get.otterdeploy.com/install.sh");
  });

  test("leaves an HTTPS request alone", () => {
    expect(httpsRedirectFor(new Request("https://get.otterdeploy.com/install.sh"))).toBeNull();
  });

  test("does not redirect local Wrangler", () => {
    expect(httpsRedirectFor(new Request("http://localhost:8787/install.sh"))).toBeNull();
  });

  test("does not redirect a lookalike hostname", () => {
    expect(
      httpsRedirectFor(new Request("http://get.otterdeploy.com.example/install.sh")),
    ).toBeNull();
    expect(httpsRedirectFor(new Request("http://get.otterdeploy.com../install.sh"))).toBeNull();
  });
});

describe("publicRedirectFor", () => {
  test.each(["http", "https"])("sends the %s root straight to the HTTPS docs", (protocol) => {
    const response = publicRedirectFor(
      new Request(`${protocol}://get.otterdeploy.com/?ignored=1`),
      "https://otterdeploy.com/docs/start/install",
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://otterdeploy.com/docs/start/install");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
  });

  test("sends the trailing-dot root straight to the HTTPS docs", () => {
    const response = publicRedirectFor(
      new Request("https://get.otterdeploy.com./"),
      "https://otterdeploy.com/docs/start/install",
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://otterdeploy.com/docs/start/install");
  });

  test("keeps the generic HTTPS upgrade for artifact paths", () => {
    const response = publicRedirectFor(
      new Request("http://get.otterdeploy.com/install.sh"),
      "https://otterdeploy.com/docs/start/install",
    );

    expect(response?.headers.get("location")).toBe("https://get.otterdeploy.com/install.sh");
  });
});

describe("withArtifactSecurityHeaders", () => {
  test("adds host-only HSTS to the HTTPS artifact edge", async () => {
    const original = new Response("artifact", { headers: { "cache-control": "public" } });
    const response = withArtifactSecurityHeaders(
      new Request("http://get.otterdeploy.com/install.sh", {
        headers: { "x-forwarded-proto": " HTTPS " },
      }),
      original,
    );

    expect(response).toBe(original);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("public");
    expect(await response.text()).toBe("artifact");
  });

  test.each([
    "http://get.otterdeploy.com/install.sh",
    "http://localhost:8787/install.sh",
    "https://preview.example/install.sh",
  ])("does not add HSTS outside public HTTPS: %s", (url) => {
    const response = withArtifactSecurityHeaders(new Request(url), new Response("artifact"));

    expect(response.headers.get("strict-transport-security")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  test("preserves an immutable redirect", () => {
    const response = withArtifactSecurityHeaders(
      new Request("https://get.otterdeploy.com/"),
      Response.redirect("https://otterdeploy.com/docs/start/install", 308),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://otterdeploy.com/docs/start/install");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });
});
