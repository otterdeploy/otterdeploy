import { describe, expect, test } from "bun:test";

import { RESERVED_SLUGS, reservedSlugConflict } from "./reserved-slugs";

describe("reservedSlugConflict", () => {
  test("refuses an organization slug that names a top-level page or server path", () => {
    for (const slug of [
      "sign-in",
      "device",
      "accept-invite",
      "onboarding",
      "terminal",
      "status",
      "api",
      "rpc",
      "jobs",
      "pty",
      "health",
      "assets",
    ]) {
      expect(reservedSlugConflict("organization", slug)).not.toBeNull();
    }
  });

  test("refuses an environment slug that names a page beside the environments", () => {
    for (const slug of ["settings", "variables", "previews"]) {
      expect(reservedSlugConflict("environment", slug)).not.toBeNull();
    }
  });

  test("allows ordinary slugs", () => {
    expect(reservedSlugConflict("organization", "acme")).toBeNull();
    expect(reservedSlugConflict("project", "settings")).toBeNull();
    expect(reservedSlugConflict("environment", "staging")).toBeNull();
    // A reserved word for one kind is fine for another.
    expect(reservedSlugConflict("environment", "terminal")).toBeNull();
  });

  test("compares the normalized slug, so casing and padding do not slip past", () => {
    expect(reservedSlugConflict("organization", "  API ")).not.toBeNull();
    expect(reservedSlugConflict("environment", "Settings")).not.toBeNull();
  });

  test("names the slug and says why, so the person creating it can pick another", () => {
    const message = reservedSlugConflict("organization", "status");
    expect(message).toContain("status");
    expect(message).toContain("reserved");
  });

  test("every list is non-empty except project, which sits behind a static /projects/ segment", () => {
    expect(RESERVED_SLUGS.organization.length).toBeGreaterThan(0);
    expect(RESERVED_SLUGS.environment.length).toBeGreaterThan(0);
    expect(RESERVED_SLUGS.project).toEqual([]);
  });
});
