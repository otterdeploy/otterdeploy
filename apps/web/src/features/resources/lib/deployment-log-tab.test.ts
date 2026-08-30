import { describe, expect, it } from "vite-plus/test";

import { logSourceForStatus } from "./deployment-log-tab";

describe("logSourceForStatus", () => {
  it("sends a live/settled deployment to its container output", () => {
    expect(logSourceForStatus("running")).toBe("deploy");
    expect(logSourceForStatus("superseded")).toBe("deploy");
  });

  it("sends anything that failed or never built to the build log", () => {
    for (const s of ["pending", "building", "failed", "crashed", "cancelled"]) {
      expect(logSourceForStatus(s)).toBe("build");
    }
  });

  it("treats an unknown status as settled rather than building", () => {
    expect(logSourceForStatus(undefined)).toBe("deploy");
    expect(logSourceForStatus(null)).toBe("deploy");
  });
});
