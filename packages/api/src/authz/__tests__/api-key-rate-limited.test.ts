/**
 * An API key that has spent its request budget is told so with a
 * 429 and a retry hint, not a 401 that reads as "your credential is wrong".
 *
 * Better Auth's api-key plugin reports the denial as `valid: false` with
 * `code: "RATE_LIMITED"`; the actor resolver turns that into a typed error and
 * the authenticating oRPC middlewares map it to 429. Only the auth instance is
 * replaced, with the shapes `getSession` / `verifyApiKey` really return.
 */
import { call, ORPCError } from "@orpc/server";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../context";

const verifyApiKey = vi.fn();

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null), verifyApiKey } },
}));
// The key store answers (a refused key is a verdict, not an outage):
// auth-store-unavailable.test.ts covers the store that does not.
vi.mock("../credential-store", () => ({
  credentialStoreAnswers: async () => Result.ok(undefined),
}));

const { ApiKeyRateLimitedError, resolveRequestActor } = await import("../actor");
const { orgScopedProcedure, protectedProcedure } = await import("../../index");

const keyHeaders = () => new Headers({ "x-api-key": "otter_testkey" });

beforeEach(() => {
  verifyApiKey.mockReset();
});

describe("resolveRequestActor", () => {
  it("a rate-limited key resolves to ApiKeyRateLimitedError with a retry hint", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      error: {
        message: "Rate limit exceeded.",
        code: "RATE_LIMITED",
        details: { tryAgainIn: 1500 },
      },
      key: null,
    });

    const resolved = await resolveRequestActor(keyHeaders());

    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error).toBeInstanceOf(ApiKeyRateLimitedError);
      if (resolved.error instanceof ApiKeyRateLimitedError) {
        expect(resolved.error.retryAfterSeconds).toBe(2);
      }
    }
  });

  it("an unknown key is still anonymous (401 path), not rate-limited", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      error: { message: "Invalid API key.", code: "INVALID_API_KEY" },
      key: null,
    });

    const resolved = await resolveRequestActor(keyHeaders());

    expect(resolved.isOk() && resolved.value).toBe(null);
  });
});

function anonymousContext(apiKeyRateLimited: Context["apiKeyRateLimited"]): Context {
  return {
    actor: null,
    session: null,
    apiKey: null,
    apiKeyRateLimited,
    activeOrganizationId: null,
    headers: keyHeaders(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: () => {},
  };
}

const input = { name: "ci", expiresIn: null, permissions: "full" as const };
const handler = async () => {
  throw new Error("the handler must not run for an unauthenticated caller");
};
/** The error a call rejects with (calls here are expected to reject). */
async function rejection(promise: () => Promise<unknown>): Promise<unknown> {
  const result = await Result.tryPromise({ try: promise, catch: (error) => error });
  expect(result.isErr()).toBe(true);
  return result.isErr() ? result.error : undefined;
}

const procedures = {
  protectedProcedure: protectedProcedure.apiKeys.create.handler(handler),
  orgScopedProcedure: orgScopedProcedure.apiKeys.create.handler(handler),
};

describe("authenticating middlewares", () => {
  for (const [name, procedure] of Object.entries(procedures)) {
    it(`${name} answers 429 for a rate-limited key`, async () => {
      const failure = await rejection(() =>
        call(procedure, input, { context: anonymousContext(new ApiKeyRateLimitedError(30)) }),
      );

      expect(failure).toBeInstanceOf(ORPCError);
      expect(failure).toMatchObject({
        status: 429,
        code: "TOO_MANY_REQUESTS",
        data: { retryAfterSeconds: 30 },
      });
    });

    it(`${name} still answers 401 when there is no actor at all`, async () => {
      const failure = await rejection(() =>
        call(procedure, input, { context: anonymousContext(null) }),
      );

      expect(failure).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    });
  }
});
