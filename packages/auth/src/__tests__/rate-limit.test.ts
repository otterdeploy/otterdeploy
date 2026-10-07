import { describe, expect, test } from "bun:test";

import {
  AUTH_RATE_LIMIT_MAX_REQUESTS,
  SESSION_READ_PATHS,
  SESSION_READ_RATE_LIMIT_MAX_REQUESTS,
  authRateLimit,
} from "../rate-limit";

describe("auth rate-limit budgets", () => {
  test("the dashboard's own session reads get the larger bucket", () => {
    for (const path of ["/get-session", "/organization/list"]) {
      expect(authRateLimit.customRules[path]?.max, path).toBe(SESSION_READ_RATE_LIMIT_MAX_REQUESTS);
    }
    expect(SESSION_READ_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(AUTH_RATE_LIMIT_MAX_REQUESTS);
  });

  test("every relaxed path is a read; nothing that signs in, mints or looks up by id is relaxed", () => {
    for (const path of SESSION_READ_PATHS) {
      expect(path, path).toMatch(/\/(get-session|list[a-z-]*)$/);
    }
    for (const path of [
      "/sign-in/email",
      "/sign-up/email",
      "/request-password-reset",
      "/two-factor/verify-totp",
      "/organization/get-invitation",
      "/api-key/create",
    ]) {
      expect(authRateLimit.customRules[path], path).toBeUndefined();
    }
  });

  test("the limiter stays on, with the default budget for everything else", () => {
    expect(authRateLimit.enabled).toBe(true);
    expect(authRateLimit.max).toBe(AUTH_RATE_LIMIT_MAX_REQUESTS);
  });
});
