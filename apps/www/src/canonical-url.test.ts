/**
 * Tests for the canonical-URL redirect.
 *
 * These exist because the obvious verification is a trap. Curling the built
 * Worker with `-H "Host: www.otterdeploy.com"` looks like it proves the www
 * rule works — but `wrangler dev` REWRITES Host to the first route declared in
 * wrangler.jsonc, so the request arrives as `otterdeploy.com` and the www
 * branch never runs. That produced a confident false negative ("www isn't
 * being stripped") against code that was correct. Asserting on the pure
 * function is the only way to actually exercise these paths.
 */
import { describe, expect, it } from "bun:test";

import { canonicalRedirectFor, canonicalUrlFor } from "./canonical-url-policy";

/** `pathname` is passed separately by the middleware, so mirror that here
 *  rather than re-deriving it and testing something the caller never does. */
function canonical(
  url: string,
  headers: Record<string, string> = {},
  pathname = new URL(url).pathname,
): string | null {
  const request = new Request(url, { headers });
  const result = canonicalUrlFor(request, pathname);
  return result === null ? null : result.toString();
}

describe("canonicalUrlFor", () => {
  it("leaves an already-canonical URL alone", () => {
    expect(canonical("https://otterdeploy.com/docs")).toBeNull();
    expect(canonical("https://otterdeploy.com/")).toBeNull();
  });

  it("upgrades http to https", () => {
    expect(canonical("http://otterdeploy.com/docs")).toBe("https://otterdeploy.com/docs");
  });

  it("trusts x-forwarded-proto over the URL's own scheme", () => {
    // The proxy terminated TLS and forwarded plaintext: the URL says https,
    // the header says the client spoke http, and the header is the truth.
    expect(canonical("https://otterdeploy.com/docs", { "x-forwarded-proto": "http" })).toBe(
      "https://otterdeploy.com/docs",
    );
    expect(canonical("http://otterdeploy.com/docs", { "x-forwarded-proto": "https" })).toBe(
      "https://otterdeploy.com/docs",
    );
  });

  it("strips www to the apex", () => {
    expect(canonical("https://www.otterdeploy.com/docs")).toBe("https://otterdeploy.com/docs");
  });

  it("removes alternate ports from production URLs", () => {
    expect(canonical("https://otterdeploy.com:8443/docs")).toBe("https://otterdeploy.com/docs");
    expect(canonical("http://www.otterdeploy.com:8080/Docs/?x=1")).toBe(
      "https://otterdeploy.com/docs?x=1",
    );
  });

  it("removes one terminal DNS root dot from exact production hosts", () => {
    expect(canonical("https://otterdeploy.com./docs")).toBe("https://otterdeploy.com/docs");
    expect(canonical("http://www.otterdeploy.com./Docs/?x=1")).toBe(
      "https://otterdeploy.com/docs?x=1",
    );
  });

  it("strips a trailing slash", () => {
    expect(canonical("https://otterdeploy.com/docs/")).toBe("https://otterdeploy.com/docs");
  });

  it("collapses a run of trailing slashes in one hop", () => {
    // Two redirects for one malformed URL is a crawl-budget tax and a
    // needless round trip.
    expect(canonical("https://otterdeploy.com/docs///")).toBe("https://otterdeploy.com/docs");
  });

  it("normalises path case and duplicate slashes", () => {
    expect(canonical("https://otterdeploy.com/Docs/Start/Install")).toBe(
      "https://otterdeploy.com/docs/start/install",
    );
    expect(canonical("http://www.otterdeploy.com//Docs//Start//Install///?x=1")).toBe(
      "https://otterdeploy.com/docs/start/install?x=1",
    );
  });

  it("normalises an encoded alias after the framework decodes its pathname", () => {
    expect(canonical("https://otterdeploy.com/%64ocs", {}, "/docs")).toBe(
      "https://otterdeploy.com/docs",
    );
    expect(canonical("http://www.otterdeploy.com/%61pi/%73earch?q=test", {}, "/api/search")).toBe(
      "https://otterdeploy.com/api/search?q=test",
    );
  });

  it("never redirects the root to the empty path", () => {
    // The guard that stops an infinite loop.
    expect(canonical("https://otterdeploy.com/")).toBeNull();
  });

  it("fixes scheme, host and path in a SINGLE redirect", () => {
    expect(canonical("http://www.otterdeploy.com/docs/")).toBe("https://otterdeploy.com/docs");
  });

  it("folds the legacy landing path into the canonical redirect", () => {
    expect(canonical("https://otterdeploy.com/next")).toBe("https://otterdeploy.com/");
    expect(canonical("http://www.otterdeploy.com/next///")).toBe("https://otterdeploy.com/");
    expect(canonical("http://www.otterdeploy.com//NEXT///")).toBe("https://otterdeploy.com/");
    expect(canonical("https://otterdeploy.com/next?ref=old-link")).toBe(
      "https://otterdeploy.com/?ref=old-link",
    );
  });

  it("preserves the query string", () => {
    expect(canonical("https://otterdeploy.com/docs/?q=deploy&page=2")).toBe(
      "https://otterdeploy.com/docs?q=deploy&page=2",
    );
  });

  it("leaves local development alone", () => {
    // Redirecting localhost to https breaks `vite dev` outright.
    expect(canonical("http://localhost:3000/docs/")).toBeNull();
    expect(canonical("http://127.0.0.1:3000/docs/")).toBeNull();
    expect(canonical("http://localhost:3000/next")).toBeNull();
    expect(canonical("https://www.otterdeploy/docs/")).toBeNull();
  });

  it("leaves every non-production preview host alone", () => {
    // Rewriting a preview host sends a reviewer to production.
    expect(canonical("https://otterdeploy-www.someone.workers.dev/docs/")).toBeNull();
    expect(canonical("https://preview.example.com/Docs/")).toBeNull();
    expect(canonical("https://otterdeploy.com.example./Docs/")).toBeNull();
    expect(canonical("https://otterdeploy.com../Docs/")).toBeNull();
  });
});

describe("canonicalRedirectFor", () => {
  it("uses 301 for GET and HEAD page aliases", () => {
    for (const method of ["GET", "HEAD"]) {
      const request = new Request("http://www.otterdeploy.com/Docs/", { method });
      const redirect = canonicalRedirectFor(request, "/Docs/", "request");

      expect(redirect?.status).toBe(301);
      expect(redirect?.url.toString()).toBe("https://otterdeploy.com/docs");
    }
  });

  it("uses 308 so a non-GET method and body survive canonicalization", () => {
    const request = new Request("http://www.otterdeploy.com/API/Search?source=test", {
      method: "POST",
      body: "query",
    });
    const redirect = canonicalRedirectFor(request, "/API/Search", "request");

    expect(redirect?.status).toBe(308);
    expect(redirect?.url.toString()).toBe("https://otterdeploy.com/api/search?source=test");
  });

  it("upgrades server functions with 308 without rewriting host, path, or query", () => {
    const request = new Request("http://www.otterdeploy.com/_serverFn/MixedCase?payload=1", {
      method: "POST",
      body: "rpc-body",
    });
    const redirect = canonicalRedirectFor(request, "/_serverFn/MixedCase", "serverFn");

    expect(redirect?.status).toBe(308);
    expect(redirect?.url.toString()).toBe(
      "https://www.otterdeploy.com/_serverFn/MixedCase?payload=1",
    );
  });

  it("removes alternate ports and one DNS root dot from server functions", () => {
    const redirect = canonicalRedirectFor(
      new Request("http://www.otterdeploy.com.:8080/_serverFn/MixedCase?payload=1", {
        method: "POST",
        body: "rpc-body",
      }),
      "/_serverFn/MixedCase",
      "serverFn",
    );

    expect(redirect?.status).toBe(308);
    expect(redirect?.url.toString()).toBe(
      "https://www.otterdeploy.com/_serverFn/MixedCase?payload=1",
    );
  });

  it("keeps the canonical server-function location HTTPS behind a TLS proxy", () => {
    const redirect = canonicalRedirectFor(
      new Request("http://otterdeploy.com:8080/_serverFn/call", {
        method: "POST",
        headers: { "x-forwarded-proto": "https" },
      }),
      "/_serverFn/call",
      "serverFn",
    );

    expect(redirect?.url.toString()).toBe("https://otterdeploy.com/_serverFn/call");
  });

  it("leaves HTTPS and local server functions untouched", () => {
    expect(
      canonicalRedirectFor(
        new Request("https://otterdeploy.com/_serverFn/call", { method: "POST" }),
        "/_serverFn/call",
        "serverFn",
      ),
    ).toBeNull();
    expect(
      canonicalRedirectFor(
        new Request("http://localhost:3000/_serverFn/call", { method: "POST" }),
        "/_serverFn/call",
        "serverFn",
      ),
    ).toBeNull();
    expect(
      canonicalRedirectFor(
        new Request("http://www.otterdeploy/_serverFn/call", { method: "POST" }),
        "/_serverFn/call",
        "serverFn",
      ),
    ).toBeNull();
  });
});
