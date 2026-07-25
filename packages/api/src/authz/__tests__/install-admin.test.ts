import { describe, expect, test } from "vite-plus/test";

import type { Context } from "../../context";

import { isInstallAdminActor } from "../install-admin";

function actor(input: {
  installAdmin: boolean;
  apiKey?: boolean;
}): Pick<Context, "apiKey" | "session"> {
  return {
    apiKey: input.apiKey
      ? {
          kind: "api-key",
          id: "key",
          permissions: null,
          organizationId: "org",
        }
      : null,
    session: {
      kind: "session",
      headers: new Headers(),
      user: {
        id: "user",
        email: "owner@example.test",
        isInstallAdmin: input.installAdmin,
        twoFactorEnabled: true,
      },
      session: { activeOrganizationId: "org" },
    },
  };
}

describe("isInstallAdminActor", () => {
  test("accepts only a real installation-admin user session", () => {
    expect(isInstallAdminActor(actor({ installAdmin: true }))).toBe(true);
    expect(isInstallAdminActor(actor({ installAdmin: false }))).toBe(false);
  });

  test("never elevates an organization API key", () => {
    expect(isInstallAdminActor(actor({ installAdmin: true, apiKey: true }))).toBe(false);
  });

  test("rejects anonymous context", () => {
    expect(isInstallAdminActor({ apiKey: null, session: null })).toBe(false);
  });
});
