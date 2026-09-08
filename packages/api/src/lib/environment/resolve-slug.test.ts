/**
 * An `environment` slug that matches nothing must be refused, not quietly
 * treated as the main environment.
 *
 * The old behaviour returned null for an unknown slug, which the apply path
 * reads as "main". A manifest describing ONE environment, sent with a slug
 * that missed — `Staging` where the slug is `staging` — therefore scoped to
 * production, and every resource the manifest did not mention was deleted
 * there. These tests pin the refusal and the message that makes the near-miss
 * obvious.
 */
import { describe, expect, it } from "vitest";

import { UnknownEnvironmentError } from "./resolve-slug";

describe("UnknownEnvironmentError", () => {
  it("names the requested slug and lists the real ones", () => {
    const error = new UnknownEnvironmentError("Staging", ["production", "staging"]);
    expect(error.message).toContain('"Staging"');
    // The whole point: the operator sees the near-miss they actually wanted.
    expect(error.message).toContain("production, staging");
    expect(error.requested).toBe("Staging");
    expect(error.available).toEqual(["production", "staging"]);
  });

  it("does not claim there are alternatives when there are none", () => {
    const error = new UnknownEnvironmentError("staging", []);
    expect(error.message).toContain("which has none");
    expect(error.message).not.toContain("Available:");
  });

  it("is an Error, so an unhandled one still surfaces rather than resolving to main", () => {
    expect(new UnknownEnvironmentError("x", [])).toBeInstanceOf(Error);
  });
});
