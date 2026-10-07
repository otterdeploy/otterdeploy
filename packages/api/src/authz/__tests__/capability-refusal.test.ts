/**
 * better-auth's hasPermission THROWS for a caller it will not evaluate (a user
 * no longer a member of the organization is a 401 APIError) instead of
 * returning success:false. The capability boundary turns that into an ordinary
 * 403 denial; any other failure (the database is down) stays a failure rather
 * than being disguised as a denial. Only the auth instance is replaced;
 * ./capability.test.ts covers the injected-permission paths.
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { SessionActor } from "../actor";
import type { Capability } from "../capability";

const hasPermission = vi.fn();

vi.mock("@otterdeploy/auth", () => ({ auth: { api: { hasPermission } } }));

const { authorizeCapability } = await import("../capability");

const actor: SessionActor = {
  kind: "session",
  headers: new Headers(),
  user: { id: "usr_1", email: "gone@example.test", isInstallAdmin: false, twoFactorEnabled: false },
  session: { activeOrganizationId: "org_1" },
};

const capability: Capability = {
  scope: "organization",
  mode: "read",
  organizationId: "org_1",
  permission: { project: ["read"] },
};

/** better-call's APIError as better-auth throws it (status + statusCode). */
function createApiError(status: string, statusCode: number): Error {
  return Object.assign(new Error("User is not a member of the organization"), {
    status,
    statusCode,
    body: { code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION" },
  });
}

beforeEach(() => {
  hasPermission.mockReset();
});

describe("a better-auth refusal is a denial, not a 500", () => {
  it("a 401/403 APIError from hasPermission denies with 403", async () => {
    for (const [status, statusCode] of [
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
    ] as const) {
      hasPermission.mockRejectedValueOnce(createApiError(status, statusCode));
      expect(await authorizeCapability(actor, capability)).toEqual({
        allowed: false,
        status: 403,
        reason: "The actor does not have the required permission.",
      });
    }
  });

  it("any other failure is rethrown, never read as a denial", async () => {
    hasPermission.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(authorizeCapability(actor, capability)).rejects.toThrow("connection terminated");
    hasPermission.mockRejectedValueOnce(createApiError("INTERNAL_SERVER_ERROR", 500));
    await expect(authorizeCapability(actor, capability)).rejects.toThrow();
  });

  it("success:false and success:true pass straight through", async () => {
    hasPermission.mockResolvedValueOnce({ error: null, success: false });
    expect((await authorizeCapability(actor, capability)).allowed).toBe(false);
    hasPermission.mockResolvedValueOnce({ error: null, success: true });
    expect(await authorizeCapability(actor, capability)).toEqual({ allowed: true });
  });
});
