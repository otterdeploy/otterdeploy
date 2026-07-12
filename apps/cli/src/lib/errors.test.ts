import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { formatCliError } from "./errors";

describe("formatCliError", () => {
  it("maps UNAUTHORIZED to a re-login hint", () => {
    const { message, hint } = formatCliError(new ORPCError("UNAUTHORIZED", { message: "no" }));
    expect(message).toMatch(/authenticated|expired/i);
    expect(hint).toBeDefined();
  });

  it("maps NO_ACTIVE_ORGANIZATION to the org hint", () => {
    const { hint } = formatCliError(new ORPCError("NO_ACTIVE_ORGANIZATION", { message: "x" }));
    expect(hint).toMatch(/org use/);
  });

  it("summarizes zod validation errors with paths", () => {
    const parsed = z.object({ project: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const { message } = formatCliError(parsed.error);
    expect(message).toMatch(/validation failed/i);
    expect(message).toMatch(/project/);
  });

  it("detects transport failures as connectivity errors", () => {
    const netErr = Object.assign(new Error("fetch failed"), { code: "ConnectionRefused" });
    const { message } = formatCliError(netErr);
    expect(message).toMatch(/reach the control plane/i);
  });

  it("passes through a plain Error message", () => {
    expect(formatCliError(new Error("boom")).message).toBe("boom");
  });
});
