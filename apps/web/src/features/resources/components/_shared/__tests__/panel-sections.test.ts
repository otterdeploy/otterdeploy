import { describe, expect, it } from "vite-plus/test";

import { sectionId } from "../panel-sections";

/**
 * Section ids double as URL fragments, so they have to be stable and readable
 * — and unique across a tab, since the id is what the rail marks and what
 * `goTo` scrolls to.
 */
describe("sectionId", () => {
  it("slugifies a title", () => {
    expect(sectionId("Health check")).toBe("health-check");
    expect(sectionId("Public networking")).toBe("public-networking");
    expect(sectionId("Danger zone")).toBe("danger-zone");
  });

  it("collapses punctuation rather than emitting it", () => {
    // A fragment with a slash or a colon in it is not a fragment.
    expect(sectionId("Deploy hooks / commands")).toBe("deploy-hooks-commands");
    expect(sectionId("TLS: certificates")).toBe("tls-certificates");
  });

  it("never starts or ends with a separator", () => {
    expect(sectionId("  Identity  ")).toBe("identity");
    expect(sectionId("(Advanced)")).toBe("advanced");
  });

  it("is stable across calls, so the marked id can't drift mid-render", () => {
    expect(sectionId("Scaling")).toBe(sectionId("Scaling"));
  });
});
