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

  test("structured JSON logs use their `level` field, not keywords", () => {
    // The all-white regression: authentik ships JSON with the severity in
    // `level`; the keyword scan saw none of these and painted every line white.
    expect(classifyLogSeverity('{"event": "Loaded config", "level": "debug"}')).toBe("normal");
    expect(classifyLogSeverity('{"event": "Starting authentik bootstrap", "level": "info"}')).toBe(
      "info",
    );
    expect(classifyLogSeverity('{"event": "DB pool exhausted", "level": "warning"}')).toBe("warn");
    expect(classifyLogSeverity('{"level":"error","msg":"connection refused"}')).toBe("error");
    expect(classifyLogSeverity('{"event":"boom","level":"critical"}')).toBe("error");
    // pino numeric levels
    expect(classifyLogSeverity('{"level":50,"msg":"down"}')).toBe("error");
    expect(classifyLogSeverity('{"level":30,"msg":"ok"}')).toBe("info");
    expect(classifyLogSeverity('{"level":20,"msg":"trace"}')).toBe("normal");
    // A JSON line with no level still falls back to the content heuristic.
    expect(classifyLogSeverity('{"msg":"TypeError: bad"}')).toBe("error");
  });
});
