import { describe, expect, it } from "vite-plus/test";

import { environmentSlugConflict, isEnvironmentSlugAllowed } from "./reserved-slugs";

/**
 * The thing being protected is not tidiness. It is that two workloads would
 * otherwise share one container name, one volume and one host, and a preview
 * teardown could destroy an environment's resources because nothing can tell
 * them apart.
 */

describe("environment slug reservations", () => {
  it("rejects the exact shape previews generate", () => {
    expect(isEnvironmentSlugAllowed("pr-7")).toBe(false);
    expect(isEnvironmentSlugAllowed("pr-128")).toBe(false);
    expect(isEnvironmentSlugAllowed("pr-0")).toBe(false);
  });

  it("rejects it case-insensitively, since slugify would fold it anyway", () => {
    expect(isEnvironmentSlugAllowed("PR-7")).toBe(false);
    expect(isEnvironmentSlugAllowed("Pr-7")).toBe(false);
  });

  it("rejects bare reserved words that read as a feature, not a place", () => {
    expect(isEnvironmentSlugAllowed("preview")).toBe(false);
    expect(isEnvironmentSlugAllowed("previews")).toBe(false);
    expect(isEnvironmentSlugAllowed("pr")).toBe(false);
  });

  it("allows slugs that merely contain or resemble the pattern", () => {
    // The rule is anchored: only a whole slug of `pr-<digits>` collides.
    // Over-reserving would block reasonable names for no benefit.
    expect(isEnvironmentSlugAllowed("pr-review")).toBe(true);
    expect(isEnvironmentSlugAllowed("prod")).toBe(true);
    expect(isEnvironmentSlugAllowed("preproduction")).toBe(true);
    expect(isEnvironmentSlugAllowed("sprint-7")).toBe(true);
    expect(isEnvironmentSlugAllowed("pr7")).toBe(true);
  });

  it("allows the ordinary environment names", () => {
    for (const slug of ["production", "staging", "development", "qa", "canary"]) {
      expect(isEnvironmentSlugAllowed(slug)).toBe(true);
    }
  });

  it("explains the conflict in terms the operator can act on", () => {
    const message = environmentSlugConflict("pr-7");
    expect(message).toContain("pr-7");
    expect(message).toContain("previews");
    expect(environmentSlugConflict("staging")).toBeNull();
  });

  it("ignores surrounding whitespace rather than letting it smuggle a collision", () => {
    expect(isEnvironmentSlugAllowed("  pr-7  ")).toBe(false);
  });
});
