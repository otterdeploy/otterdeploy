import type { PreviewId } from "@otterdeploy/shared/id";

import { describe, expect, it } from "vite-plus/test";

import { previewHostLabel, previewSlug, runtimeServiceName, type PreviewScope } from "./scoping";

const scope: PreviewScope = {
  id: "prev_pr7" as PreviewId,
  slug: "acme-app-pr-7",
  prNumber: 7,
};

describe("preview scoping", () => {
  it("previewSlug is the stable pr-<n> suffix", () => {
    expect(previewSlug(scope)).toBe("pr-7");
  });

  it("runtimeServiceName leaves base deploys untouched (production byte-identical)", () => {
    expect(runtimeServiceName("web", null)).toBe("web");
    expect(runtimeServiceName("web", undefined)).toBe("web");
  });

  it("runtimeServiceName suffixes preview scopes with the pr slug", () => {
    expect(runtimeServiceName("web", scope)).toBe("web-pr-7");
  });

  it("previewHostLabel scopes preview hosts, leaves base alone", () => {
    expect(previewHostLabel("web", null)).toBe("web");
    expect(previewHostLabel("web", scope)).toBe("web-pr-7");
  });
});
