import { describe, expect, it } from "vite-plus/test";

import { deriveServerState, hasReadings, isControlPlaneRow, isReporting } from "./server-state";

const ready = {
  provisionStatus: "ready",
  status: "ready",
  availability: "active",
  provisionError: null,
} as const;

const fresh = { stale: false, receivedAt: new Date().toISOString() };

describe("deriveServerState", () => {
  it("reports connected when the latest report is fresh", () => {
    expect(deriveServerState(ready, fresh).kind).toBe("connected");
  });

  it("reports stale when the report is old but the box is up", () => {
    expect(deriveServerState(ready, { ...fresh, stale: true }).kind).toBe("stale");
  });

  it("reports unreported when no report has ever arrived", () => {
    expect(deriveServerState(ready, null).kind).toBe("unreported");
  });

  it("lets an operator's pause or drain win over freshness", () => {
    expect(deriveServerState({ ...ready, availability: "pause" }, fresh).kind).toBe("paused");
    expect(deriveServerState({ ...ready, availability: "drain" }, fresh).kind).toBe("draining");
  });

  it("lets swarm's down status win over the last report", () => {
    expect(deriveServerState({ ...ready, status: "down" }, fresh).kind).toBe("down");
  });

  it("puts provisioning ahead of everything", () => {
    expect(deriveServerState({ ...ready, provisionStatus: "joining" }, fresh).kind).toBe(
      "provisioning",
    );
    const failed = deriveServerState(
      { ...ready, provisionStatus: "failed", provisionError: "ssh refused" },
      fresh,
    );
    expect(failed.kind).toBe("failed");
    expect(failed.detail).toBe("ssh refused");
  });
});

describe("reading gates", () => {
  it("shows stale readings but not a down box's", () => {
    expect(hasReadings("stale")).toBe(true);
    expect(hasReadings("down")).toBe(false);
    expect(isReporting("stale")).toBe(false);
    expect(isReporting("paused")).toBe(true);
  });
});

describe("isControlPlaneRow", () => {
  it("recognises the bootstrap row by label or by local manager address", () => {
    expect(
      isControlPlaneRow({ role: "worker", host: "1.2.3.4", name: "a", labels: ["bootstrap"] }),
    ).toBe(true);
    expect(isControlPlaneRow({ role: "manager", host: "127.0.0.1", name: "a", labels: [] })).toBe(
      true,
    );
    expect(isControlPlaneRow({ role: "manager", host: "1.2.3.4", name: "hel-2", labels: [] })).toBe(
      false,
    );
  });
});
