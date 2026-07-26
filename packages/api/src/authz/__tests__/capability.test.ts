import { describe, expect, test } from "vite-plus/test";

import type { ApiKeyActor, SessionActor } from "../actor";
import type { Capability } from "../capability";

// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.DATABASE_URL ??= "postgres://test/test";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.RESEND_API_KEY ??= "test-resend-key";

const { authorizeCapability } = await import("../capability");

const sessionActor: SessionActor = {
  kind: "session",
  headers: new Headers(),
  user: {
    id: "user_1",
    email: "operator@example.test",
    isInstallAdmin: false,
    twoFactorEnabled: true,
  },
  session: { activeOrganizationId: "org_1" },
};

function apiKey(overrides: Partial<ApiKeyActor> = {}): ApiKeyActor {
  return {
    kind: "api-key",
    id: "key_1",
    organizationId: "org_1",
    permissions: { service: ["deploy"], terminal: ["open"] },
    accessLevel: "write",
    projectScope: "all",
    ...overrides,
  };
}

const deployCapability: Capability = {
  scope: "organization",
  mode: "write",
  organizationId: "org_1",
  projectId: "project_1",
  permission: { service: ["deploy"] },
};

describe("authorizeCapability", () => {
  test("rejects anonymous actors", async () => {
    expect(await authorizeCapability(null, deployCapability)).toEqual({
      allowed: false,
      status: 401,
      reason: "Authentication is required.",
    });
  });

  test("rejects organization mismatches before permission checks", async () => {
    const decision = await authorizeCapability(
      apiKey({ organizationId: "org_other" }),
      deployCapability,
    );
    expect(decision.allowed).toBe(false);
  });

  test("blocks writes made with read-only keys", async () => {
    const decision = await authorizeCapability(apiKey({ accessLevel: "read" }), deployCapability);
    expect(decision).toMatchObject({ allowed: false, reason: "This API key is read-only." });
  });

  test("intersects API-key permissions with project scope", async () => {
    const missingPermission = await authorizeCapability(
      apiKey({ permissions: { service: ["read"] } }),
      deployCapability,
    );
    expect(missingPermission.allowed).toBe(false);

    const wrongProject = await authorizeCapability(
      apiKey({ projectScope: "selected", projectIds: ["project_2"] }),
      deployCapability,
    );
    expect(wrongProject).toMatchObject({
      allowed: false,
      reason: "This API key is not scoped to that project.",
    });

    const allowed = await authorizeCapability(
      apiKey({ projectScope: "selected", projectIds: ["project_1"] }),
      deployCapability,
    );
    expect(allowed).toEqual({ allowed: true });
  });

  test("uses the live session permission decision", async () => {
    const denied = await authorizeCapability(sessionActor, deployCapability, {
      hasSessionPermission: async () => false,
    });
    expect(denied.allowed).toBe(false);

    const allowed = await authorizeCapability(sessionActor, deployCapability, {
      hasSessionPermission: async () => true,
    });
    expect(allowed).toEqual({ allowed: true });
  });

  test("never grants installation authority to an API key", async () => {
    const denied = await authorizeCapability(apiKey(), {
      scope: "install",
      mode: "write",
    });
    expect(denied.allowed).toBe(false);

    const allowed = await authorizeCapability(
      {
        ...sessionActor,
        user: { ...sessionActor.user, isInstallAdmin: true },
      },
      { scope: "install", mode: "write" },
    );
    expect(allowed).toEqual({ allowed: true });
  });
});
