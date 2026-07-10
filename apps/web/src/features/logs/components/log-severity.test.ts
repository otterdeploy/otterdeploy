import { describe, expect, it } from "vite-plus/test";

import { classifyLogSeverity } from "./log-severity";

describe("classifyLogSeverity", () => {
  it("flags config-complaint lines as warn (stream-based red was lost in the content rewrite)", () => {
    // Verbatim Upstash SDK output from a service missing its Redis env.
    expect(
      classifyLogSeverity(
        "[Upstash Redis] The 'url' property is missing or undefined in your Redis config.",
      ),
    ).toBe("warn");
    expect(
      classifyLogSeverity(
        "[Upstash Redis] The 'token' property is missing or undefined in your Redis config.",
      ),
    ).toBe("warn");
    expect(classifyLogSeverity("REDIS_URL is not set")).toBe("warn");
    expect(classifyLogSeverity("Email isn't configured")).toBe("warn");
    expect(classifyLogSeverity("SMTP transport not configured, skipping send")).toBe("warn");
  });

  it("keeps error markers ahead of the config-complaint bucket", () => {
    // "failed" outranks "is missing" — first matching bucket wins.
    expect(classifyLogSeverity("failed: config file is missing")).toBe("error");
    expect(classifyLogSeverity("Error: connect ECONNREFUSED 127.0.0.1:6379")).toBe("error");
  });

  it("does not repaint healthy output", () => {
    expect(classifyLogSeverity("Compiled successfully")).toBe("success");
    expect(classifyLogSeverity("GET /api/health 200 in 3ms")).toBe("normal");
    expect(classifyLogSeverity("Cloning into 'app'...")).toBe("normal");
  });

  it("still short-circuits builder command echo to info", () => {
    expect(classifyLogSeverity("$ railpack prepare /src --error-missing-start")).toBe("info");
  });
});
