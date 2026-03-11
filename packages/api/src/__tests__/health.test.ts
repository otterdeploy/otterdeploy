import { describe, expect, it } from "vitest";
import { router } from "../routers";

describe("health router", () => {
  it("should have health route defined", () => {
    expect(router).toBeDefined();
    expect(router.health).toBeDefined();
  });
});
