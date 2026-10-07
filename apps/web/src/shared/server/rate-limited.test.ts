import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_RETRY_AFTER_SECONDS,
  RateLimitedError,
  createRetryAfterProbe,
  parseRetryAfter,
  rateLimitRetryAfter,
} from "./rate-limited";

describe("parseRetryAfter", () => {
  it("reads better-auth's X-Retry-After and the standard Retry-After", () => {
    expect(parseRetryAfter(new Headers({ "X-Retry-After": "17" }))).toBe(17);
    expect(parseRetryAfter(new Headers({ "Retry-After": "4" }))).toBe(4);
  });

  it("falls back to a default when the hint is absent or unparsable", () => {
    expect(parseRetryAfter(new Headers())).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(parseRetryAfter(new Headers({ "Retry-After": "soon" }))).toBe(
      DEFAULT_RETRY_AFTER_SECONDS,
    );
  });

  it("clamps to at least a second and at most the countdown ceiling", () => {
    expect(parseRetryAfter(new Headers({ "X-Retry-After": "0" }))).toBe(1);
    expect(parseRetryAfter(new Headers({ "X-Retry-After": "86400" }))).toBe(
      MAX_RETRY_AFTER_SECONDS,
    );
  });
});

describe("createRetryAfterProbe", () => {
  it("records the hint of the response that failed", () => {
    const probe = createRetryAfterProbe();
    expect(probe.retryAfterSeconds).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    probe.fetchOptions.onError({
      response: new Response(null, { status: 429, headers: { "X-Retry-After": "23" } }),
    });
    expect(probe.retryAfterSeconds).toBe(23);
  });
});

describe("rateLimitRetryAfter (what the error boundary branches on)", () => {
  it("is the wait for a rate limit, from an auth read or an oRPC 429", () => {
    expect(rateLimitRetryAfter(new RateLimitedError(9))).toBe(9);
    expect(
      rateLimitRetryAfter(
        new ORPCError("TOO_MANY_REQUESTS", { status: 429, data: { retryAfterSeconds: 30 } }),
      ),
    ).toBe(30);
    expect(rateLimitRetryAfter(new ORPCError("TOO_MANY_REQUESTS", { status: 429 }))).toBe(
      DEFAULT_RETRY_AFTER_SECONDS,
    );
  });

  it("is null for every other failure, which keeps its own screen", () => {
    expect(rateLimitRetryAfter(new Error("boom"))).toBeNull();
    expect(rateLimitRetryAfter(new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 }))).toBeNull();
    expect(rateLimitRetryAfter(undefined)).toBeNull();
  });
});
