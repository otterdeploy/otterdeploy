import { describe, expect, test } from "vite-plus/test";

import {
  buildHttpHealthcheckCmd,
  isValidHealthcheckPath,
  normalizeHealthcheckPath,
  parseHttpHealthcheckCmd,
} from "./healthcheck-http";

describe("buildHttpHealthcheckCmd", () => {
  test("generates a CMD-SHELL wget-then-curl probe", () => {
    const cmd = buildHttpHealthcheckCmd({ path: "/health", port: 3000 });
    expect(cmd).toEqual([
      "CMD-SHELL",
      'wget -q -O /dev/null "http://127.0.0.1:3000/health" || curl -fsS -o /dev/null "http://127.0.0.1:3000/health"',
    ]);
  });

  test("normalizes a missing leading slash and empty path", () => {
    expect(buildHttpHealthcheckCmd({ path: "healthz", port: 80 })[1]).toContain(
      "http://127.0.0.1:80/healthz",
    );
    expect(buildHttpHealthcheckCmd({ path: "", port: 80 })[1]).toContain("http://127.0.0.1:80/");
  });

  test("rejects shell-active characters in the path", () => {
    expect(() => buildHttpHealthcheckCmd({ path: '/x" || rm -rf /', port: 80 })).toThrow();
    expect(() => buildHttpHealthcheckCmd({ path: "/$(reboot)", port: 80 })).toThrow();
    expect(() => buildHttpHealthcheckCmd({ path: "/`id`", port: 80 })).toThrow();
  });

  test("rejects out-of-range ports", () => {
    expect(() => buildHttpHealthcheckCmd({ path: "/", port: 0 })).toThrow();
    expect(() => buildHttpHealthcheckCmd({ path: "/", port: 70000 })).toThrow();
    expect(() => buildHttpHealthcheckCmd({ path: "/", port: 3.5 })).toThrow();
  });
});

describe("parseHttpHealthcheckCmd", () => {
  test("round-trips what build generates", () => {
    const check = { path: "/api/health?deep=1", port: 8080 };
    expect(parseHttpHealthcheckCmd(buildHttpHealthcheckCmd(check))).toEqual(check);
  });

  test("returns null for custom commands", () => {
    expect(parseHttpHealthcheckCmd(null)).toBeNull();
    expect(parseHttpHealthcheckCmd(undefined)).toBeNull();
    expect(parseHttpHealthcheckCmd([])).toBeNull();
    expect(parseHttpHealthcheckCmd(["curl", "-f", "http://127.0.0.1:3000/health"])).toBeNull();
    expect(parseHttpHealthcheckCmd(["CMD-SHELL", "pg_isready -U postgres"])).toBeNull();
    // Our marker but an edited script with mismatched URLs — not invertible.
    expect(
      parseHttpHealthcheckCmd([
        "CMD-SHELL",
        'wget -q -O /dev/null "http://127.0.0.1:3000/a" || curl -fsS -o /dev/null "http://127.0.0.1:3000/b"',
      ]),
    ).toBeNull();
  });
});

describe("path helpers", () => {
  test("normalize trims and prefixes", () => {
    expect(normalizeHealthcheckPath("  health ".trim())).toBe("/health");
    expect(normalizeHealthcheckPath("/ready")).toBe("/ready");
    expect(normalizeHealthcheckPath("")).toBe("/");
  });

  test("validity check", () => {
    expect(isValidHealthcheckPath("/health")).toBe(true);
    expect(isValidHealthcheckPath("/v1/status?probe=lb")).toBe(true);
    expect(isValidHealthcheckPath("health")).toBe(false);
    expect(isValidHealthcheckPath('/no"quotes')).toBe(false);
    expect(isValidHealthcheckPath("/no space")).toBe(false);
  });
});
