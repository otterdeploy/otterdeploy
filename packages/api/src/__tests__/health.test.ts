import { describe, expect, it } from "vitest";
import { createHealthRouter } from "../router";

describe("health router", () => {
  it("should return ok status", async () => {
    const router = createHealthRouter();
    expect(router).toBeDefined();
    expect(router.health).toBeDefined();
  });
});
