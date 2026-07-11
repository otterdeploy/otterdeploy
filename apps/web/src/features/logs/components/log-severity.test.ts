import { describe, expect, test } from "vitest";

import { classifyLogSeverity } from "./log-severity";

describe("classifyLogSeverity", () => {
  test("runtime exceptions classify as errors (Upstash regression)", () => {
    expect(
      classifyLogSeverity(
        "[Upstash Redis] Redis client was initialized without url or token. Failed to execute command.",
      ),
    ).toBe("error");
    expect(classifyLogSeverity("⨯ TypeError: Failed to parse URL from")).toBe("error");
    expect(
      classifyLogSeverity("    at u.startActiveSpan (.next/server/chunks/175.js:2:27262)"),
    ).toBe("error");
    expect(classifyLogSeverity("[cause]: TypeError: Invalid URL")).toBe("error");
  });

  test("Next.js ⨯ marker alone is an error even without an Error name", () => {
    expect(classifyLogSeverity("⨯ unhandledRejection: connect ECONNREFUSED")).toBe("error");
  });

  test("warnings and plain output keep their buckets", () => {
    expect(classifyLogSeverity("WARN  deprecated package")).toBe("warn");
    expect(classifyLogSeverity("GET /api/products 200 in 14ms")).toBe("normal");
    expect(classifyLogSeverity("✓ Ready in 1200ms")).toBe("success");
  });
});
