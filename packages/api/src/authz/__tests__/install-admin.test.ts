import { describe, expect, test } from "vitest";

import type { Context } from "../../context";

import { isInstallAdminActor } from "../install-admin";

function actor(input: {
  installAdmin: boolean;
  apiKey?: boolean;
}): Pick<Context, "apiKey" | "session"> {
  return {
    apiKey: input.apiKey
      ? {
          id: "key",
          permissions: null,
          referenceId: "org",
        }
      : null,
    session: {
      user: {
        id: "user",
        email: "owner@example.test",
        isInstallAdmin: input.installAdmin,
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
