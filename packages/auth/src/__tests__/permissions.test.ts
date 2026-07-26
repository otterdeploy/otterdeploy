import { describe, expect, test } from "bun:test";

import { admin, member, owner } from "../permissions";

describe("organization roles", () => {
  test("never grant installation platform authority", () => {
    for (const role of [member, admin, owner]) {
      expect(role.authorize({ platform: ["read"] }).success).toBe(false);
      expect(role.authorize({ platform: ["update"] }).success).toBe(false);
    }
  });

  test("retain organization-local administration", () => {
    expect(owner.authorize({ organization: ["update"] }).success).toBe(true);
    expect(admin.authorize({ organization: ["update"] }).success).toBe(true);
  });
});
