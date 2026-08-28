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

import { canonicalUrlFor } from "./canonical-url";

/** `pathname` is passed separately by the middleware, so mirror that here
 *  rather than re-deriving it and testing something the caller never does. */
function canonical(url: string, headers: Record<string, string> = {}): string | null {
  const request = new Request(url, { headers });
  const result = canonicalUrlFor(request, new URL(url).pathname);
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
  });

  it("strips www to the apex", () => {
    expect(canonical("https://www.otterdeploy.com/docs")).toBe("https://otterdeploy.com/docs");
  });

  it("strips a trailing slash", () => {
    expect(canonical("https://otterdeploy.com/docs/")).toBe("https://otterdeploy.com/docs");
  });

  it("collapses a run of trailing slashes in one hop", () => {
    // Two redirects for one malformed URL is a crawl-budget tax and a
    // needless round trip.
    expect(canonical("https://otterdeploy.com/docs///")).toBe("https://otterdeploy.com/docs");
  });

  it("never redirects the root to the empty path", () => {
    // The guard that stops an infinite loop.
    expect(canonical("https://otterdeploy.com/")).toBeNull();
  });

  it("fixes scheme, host and path in a SINGLE redirect", () => {
    expect(canonical("http://www.otterdeploy.com/docs/")).toBe("https://otterdeploy.com/docs");
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
  });

  it("leaves workers.dev preview hosts alone", () => {
    // Rewriting a preview host sends a reviewer to production.
    expect(canonical("https://otterdeploy-www.someone.workers.dev/docs/")).toBeNull();
  });
});
