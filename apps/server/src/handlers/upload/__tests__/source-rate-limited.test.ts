/**
 * `POST /api/services/:resourceId/source` tells a rate-limited API
 * key so, with a 429 and a `Retry-After`, the same answer the oRPC procedures
 * give (authz/__tests__/api-key-rate-limited.test.ts), not a 401 that reads as
 * "your credential is wrong".
 *
 * Drives the REAL `uploadSourceHandler` and the real actor resolver over HTTP
 * (Hono's `app.request`); only the auth instance is replaced. A refused caller
 * is answered before any service lookup, so nothing here touches a database.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

// oxlint-disable-next-line node/no-process-env -- test env setup boundary: satisfy required vars so the module graph (db/auth/env) loads under vitest too (bun test preloads test-setup.ts).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.RESEND_API_KEY ??= "test-resend-key";

// Only the auth instance is replaced, with the shape Better Auth's api-key
// plugin really returns for a key over its budget; the actor resolver that
// turns it into ApiKeyRateLimitedError is the real one.
const verifyApiKey = vi.fn();

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null), verifyApiKey } },
}));

const { uploadSourceHandler } = await import("../source");

const app = new Hono().post("/api/services/:resourceId/source", uploadSourceHandler);

const errorBody = z.object({ error: z.string() });

describe("upload source with a rate-limited API key", () => {
  beforeEach(() => {
    verifyApiKey.mockReset();
  });

  test("answers 429 with Retry-After and the limiter's message", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: false,
      error: {
        message: "Rate limit exceeded.",
        code: "RATE_LIMITED",
        details: { tryAgainIn: 29_500 },
      },
      key: null,
    });

    const response = await app.request("/api/services/res_web/source", {
      method: "POST",
      headers: { "x-api-key": "otter_testkey", "content-type": "application/gzip" },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(errorBody.parse(await response.json())).toEqual({
      error: "API key rate limit exceeded. Try again in 30s.",
    });
  });

  // Control: the same request with no actor at all is a 401, so the case
  // above fails on the rate-limit mapping and nothing else.
  test("an anonymous caller still answers 401", async () => {
    const response = await app.request("/api/services/res_web/source", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });

    expect(response.status).toBe(401);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });
});
