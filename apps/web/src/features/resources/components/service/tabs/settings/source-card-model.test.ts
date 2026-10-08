/**
 * The Source card's promise about what deploys a service follows the binding
 *: a public-URL repo has no push webhook.
 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));

const { sourceDescriptionKey } = await import("./source-card-model");

describe("sourceDescriptionKey", () => {
  it("promises push deploys only for an installation-bound repo", () => {
    expect(sourceDescriptionKey("push")).toBe("resources.source.description");
  });
  it("says a public-URL binding deploys on a Deploy click", () => {
    expect(sourceDescriptionKey("manual")).toBe("resources.source.descriptionManual");
  });
  it("promises neither while the binding is unknown", () => {
    expect(sourceDescriptionKey(undefined)).toBe("resources.source.descriptionUnknown");
    expect(sourceDescriptionKey(null)).toBe("resources.source.descriptionUnknown");
  });
});
