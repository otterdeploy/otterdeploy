import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { formatCliError } from "./errors";

describe("formatCliError", () => {
  it("maps UNAUTHORIZED to a re-login hint", () => {
    const { message, hints } = formatCliError(new ORPCError("UNAUTHORIZED", { message: "no" }));
    expect(message).toMatch(/authenticated|expired/i);
    expect(hints.length).toBeGreaterThan(0);
  });

  it("maps NO_ACTIVE_ORGANIZATION to the org hints", () => {
    const { hints } = formatCliError(new ORPCError("NO_ACTIVE_ORGANIZATION", { message: "x" }));
    expect(hints.join(" ")).toMatch(/org use/);
  });

  it("names every invalid config field, not just the first", () => {
    const parsed = z.object({ project: z.string(), region: z.string() }).safeParse({ project: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const { message, details } = formatCliError(parsed.error);
    expect(message).toMatch(/validation failed/i);
    expect(details).toHaveLength(2);
    expect(details?.join("\n")).toMatch(/project/);
    expect(details?.join("\n")).toMatch(/region/);
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
