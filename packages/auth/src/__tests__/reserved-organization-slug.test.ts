import { describe, expect, test } from "bun:test";

import { reservedOrganizationSlugError } from "../reserved-organization-slug";

describe("reservedOrganizationSlugError", () => {
  test("refuses a slug that a top-level page already answers", () => {
    // `/status/…` is the public status page and `/api` belongs to the server:
    // an organization slugged either would never be reachable at `/<slug>`.
    for (const slug of ["status", "api", "sign-in", "terminal"]) {
      expect(reservedOrganizationSlugError({ slug })).not.toBeNull();
    }
  });

  test("lets an ordinary slug through", () => {
    expect(reservedOrganizationSlugError({ slug: "acme" })).toBeNull();
  });

  test("ignores an update that does not touch the slug", () => {
    expect(reservedOrganizationSlugError({})).toBeNull();
  });

  test("says which slug and why", () => {
    expect(reservedOrganizationSlugError({ slug: "status" })).toContain("status");
  });
});
