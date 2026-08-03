import { describe, expect, test } from "vitest";

import { logTabForStatus } from "./deployment-log-tab";

describe("logTabForStatus", () => {
  test("a running deployment opens its container output", () => {
    expect(logTabForStatus("running")).toBe("deploy-logs");
  });

  test("in-flight and failed deployments open the build log", () => {
    for (const s of ["pending", "building", "failed", "crashed", "cancelled"]) {
      expect(logTabForStatus(s)).toBe("build-logs");
    }
  });

  test("never returns the details tab — this control is labelled View logs", () => {
    for (const s of ["running", "superseded", "removed", "weird-new-status", null, undefined]) {
      expect(logTabForStatus(s)).not.toBe("details");
    }
  });
});
