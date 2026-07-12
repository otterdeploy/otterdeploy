import { describe, expect, test } from "vite-plus/test";

import { toHealthcheckTest } from "../internals";

describe("toHealthcheckTest", () => {
  test("prefixes bare exec-form commands with CMD (legacy rows)", () => {
    expect(toHealthcheckTest(["curl", "-f", "http://127.0.0.1:3000/health"])).toEqual([
      "CMD",
      "curl",
      "-f",
      "http://127.0.0.1:3000/health",
    ]);
  });

  test("passes an explicit CMD-SHELL one-liner through verbatim", () => {
    const cmd = ["CMD-SHELL", "wget -qO /dev/null http://127.0.0.1:3000/health"];
    expect(toHealthcheckTest(cmd)).toEqual(cmd);
  });

  test("passes explicit CMD and NONE markers through verbatim", () => {
    expect(toHealthcheckTest(["CMD", "true"])).toEqual(["CMD", "true"]);
    expect(toHealthcheckTest(["NONE"])).toEqual(["NONE"]);
  });

  test("returns a copy, never the caller's array", () => {
    const cmd = ["CMD-SHELL", "true"];
    const out = toHealthcheckTest(cmd);
    expect(out).not.toBe(cmd);
  });

  test("marker matching is case-sensitive (docker requires uppercase)", () => {
    expect(toHealthcheckTest(["cmd-shell", "true"])).toEqual(["CMD", "cmd-shell", "true"]);
  });
});
