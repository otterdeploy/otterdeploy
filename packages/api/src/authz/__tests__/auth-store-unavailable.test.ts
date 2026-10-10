/**
 * When the credential store (Postgres) cannot be read, the caller
 * is told the service is unavailable (503), not that it is signed out (401).
 *
 * better-auth answers a session it could not read with a 500, and the api-key
 * plugin answers a key it could not look up with the same INVALID_API_KEY it
 * gives a key that does not exist. resolveRequestActor used to fold both into
 * "no actor", so a signed-in dashboard was answered UNAUTHORIZED during an
 * outage and signed the user out. Only the auth instance and the store probe
 * are replaced, with the shapes they really produce.
 */
import { call, ORPCError } from "@orpc/server";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../context";

const getSession = vi.fn();
const verifyApiKey = vi.fn();
const storeAnswers = vi.fn();

vi.mock("@otterdeploy/auth", () => ({ auth: { api: { getSession, verifyApiKey } } }));
vi.mock("../credential-store", () => ({ credentialStoreAnswers: storeAnswers }));

const { AuthStoreUnavailableError, resolveRequestActor } = await import("../actor");
const { orgScopedProcedure, protectedProcedure } = await import("../../index");

/** better-auth's own rejection: an APIError carries its HTTP status. */
function apiError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(statusCode === 500 ? "Failed to get session" : "Unauthorized"), {
    statusCode,
  });
}

const STORE_DOWN = Result.err(new Error("Connection refused"));
const STORE_UP = Result.ok(undefined);
const sessionHeaders = () => new Headers({ cookie: "better-auth.session_token=signed" });
const keyHeaders = () => new Headers({ "x-api-key": "otter_testkey" });

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(null);
  verifyApiKey.mockReset();
  storeAnswers.mockReset().mockResolvedValue(STORE_UP);
});

describe("resolveRequestActor with the store down", () => {
  it("a session lookup that fails while the store is down is AuthStoreUnavailableError, not anonymous", async () => {
    getSession.mockRejectedValue(apiError(500));
    storeAnswers.mockResolvedValue(STORE_DOWN);

    const resolved = await resolveRequestActor(sessionHeaders());

    expect(resolved.isErr() && resolved.error).toBeInstanceOf(AuthStoreUnavailableError);
  });

  it("a session lookup that fails while the store answers stays anonymous (a mangled cookie is not an outage)", async () => {
    getSession.mockRejectedValue(apiError(500));

    const resolved = await resolveRequestActor(sessionHeaders());

    expect(resolved.isOk() && resolved.value).toBe(null);
  });

  it("a session better-auth rejects (4xx) is anonymous without asking the store", async () => {
    getSession.mockRejectedValue(apiError(401));
    storeAnswers.mockResolvedValue(STORE_DOWN);

    const resolved = await resolveRequestActor(sessionHeaders());

    expect(resolved.isOk() && resolved.value).toBe(null);
    expect(storeAnswers).not.toHaveBeenCalled();
  });

  it("a key the plugin could not look up (INVALID_API_KEY with the store down) is AuthStoreUnavailableError", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      error: { message: "Invalid API key.", code: "INVALID_API_KEY" },
      key: null,
    });
    storeAnswers.mockResolvedValue(STORE_DOWN);

    const resolved = await resolveRequestActor(keyHeaders());

    expect(resolved.isErr() && resolved.error).toBeInstanceOf(AuthStoreUnavailableError);
  });

  it("a key verification that throws a 5xx while the store is down is AuthStoreUnavailableError", async () => {
    verifyApiKey.mockRejectedValue(apiError(500));
    storeAnswers.mockResolvedValue(STORE_DOWN);

    const resolved = await resolveRequestActor(keyHeaders());

    expect(resolved.isErr() && resolved.error).toBeInstanceOf(AuthStoreUnavailableError);
  });

  it("an unknown key while the store answers is still anonymous", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      error: { message: "Invalid API key.", code: "INVALID_API_KEY" },
      key: null,
    });

    const resolved = await resolveRequestActor(keyHeaders());

    expect(resolved.isOk() && resolved.value).toBe(null);
  });
});

function unavailableContext(): Context {
  return {
    actor: null,
    session: null,
    apiKey: null,
    apiKeyRateLimited: null,
    authUnavailable: new AuthStoreUnavailableError(new Error("Connection refused")),
    activeOrganizationId: null,
    headers: sessionHeaders(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: () => {},
  };
}

const input = { name: "ci", expiresIn: null, permissions: "full" as const };
const handler = async () => {
  throw new Error("the handler must not run for a caller nobody could identify");
};

describe("authenticating middlewares", () => {
  const procedures = [
    { name: "protectedProcedure", procedure: protectedProcedure.apiKeys.create.handler(handler) },
    { name: "orgScopedProcedure", procedure: orgScopedProcedure.apiKeys.create.handler(handler) },
  ];
  for (const { name, procedure } of procedures) {
    it(`${name} answers 503 SERVICE_UNAVAILABLE, not 401, when the store could not be read`, async () => {
      const failure = await Result.tryPromise({
        try: () => call(procedure, input, { context: unavailableContext() }),
        catch: (error) => error,
      });

      expect(failure.isErr()).toBe(true);
      const error = failure.isErr() ? failure.error : undefined;
      expect(error).toBeInstanceOf(ORPCError);
      expect(error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    });
  }
});
