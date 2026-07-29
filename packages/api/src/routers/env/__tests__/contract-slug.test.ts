import { describe, expect, it } from "vite-plus/test";

import { createEnvInput } from "../contract";

/**
 * The reserved-slug rule is only worth anything if it is enforced where
 * environments are actually created. These assert the wiring, not the helper —
 * `reserved-slugs.test.ts` covers the rule itself.
 */

const valid = { name: "Staging", slug: "staging" };

describe("createEnv input", () => {
  it("accepts an ordinary environment", () => {
    expect(createEnvInput.safeParse(valid).success).toBe(true);
  });

  it("rejects a slug that would collide with a preview's generated name", () => {
    const result = createEnvInput.safeParse({ name: "PR 7", slug: "pr-7" });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The operator has to be able to act on this, so the message names the
      // slug and says what it collides with.
      const message = result.error.issues.map((i) => i.message).join(" ");
      expect(message).toContain("pr-7");
      expect(message).toContain("previews");
    }
  });

  it("rejects the reserved bare words", () => {
    for (const slug of ["preview", "previews", "pr"]) {
      expect(createEnvInput.safeParse({ name: slug, slug }).success).toBe(false);
    }
  });

  it("still enforces the pre-existing length bounds", () => {
    // The refinement is additive — it must not have replaced min/max.
    expect(createEnvInput.safeParse({ name: "x", slug: "a" }).success).toBe(false);
    expect(createEnvInput.safeParse({ name: "x", slug: "a".repeat(49) }).success).toBe(false);
  });

  it("leaves names alone — only the slug is reserved", () => {
    // An environment can be *called* "Preview"; it just cannot be slugged that.
    expect(createEnvInput.safeParse({ name: "Preview", slug: "review" }).success).toBe(true);
  });
});
