import { describe, expect, test } from "vite-plus/test";

import { deriveServicePanelState, isServicePaused, replicaSummary } from "./service-status";

describe("isServicePaused", () => {
  test("paused only when the explicit marker is set", () => {
    expect(isServicePaused({ pausedReplicas: 2 })).toBe(true);
    expect(isServicePaused({ pausedReplicas: null })).toBe(false);
  });
});

describe("deriveServicePanelState", () => {
  test("pause marker overrides any runtime status", () => {
    expect(deriveServicePanelState({ pausedReplicas: 1, runtimeStatus: "missing" })).toBe("paused");
    expect(deriveServicePanelState({ pausedReplicas: 3, runtimeStatus: "stopped" })).toBe("paused");
    // Transitional: the container hasn't been torn down yet — still paused,
    // the operator's intent is what the panel reports.
    expect(deriveServicePanelState({ pausedReplicas: 1, runtimeStatus: "running" })).toBe("paused");
  });

  test("a zero-replica service WITHOUT the marker is not paused", () => {
    // Manually scaled to zero → the runtime says missing/stopped and the
    // panel must not dress that up as paused (or as crashed).
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: "missing" })).toBe(
      "missing",
    );
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: "stopped" })).toBe(
      "stopped",
    );
  });

  test("passes live runtime statuses through", () => {
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: "running" })).toBe(
      "running",
    );
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: "starting" })).toBe(
      "starting",
    );
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: "error" })).toBe("error");
  });

  test("unknown while the live view is loading — never a guess", () => {
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: undefined })).toBe(
      "unknown",
    );
    expect(deriveServicePanelState({ pausedReplicas: null, runtimeStatus: null })).toBe("unknown");
  });
});

describe("replicaSummary", () => {
  test("paused summary names the restored count", () => {
    expect(replicaSummary({ replicas: 0, pausedReplicas: 1 })).toBe(
      "Paused — 1 replica restored on resume",
    );
    expect(replicaSummary({ replicas: 0, pausedReplicas: 3 })).toBe(
      "Paused — 3 replicas restored on resume",
    );
  });

  test("normal summary shows the desired count, including zero", () => {
    expect(replicaSummary({ replicas: 1, pausedReplicas: null })).toBe("1 desired replica");
    expect(replicaSummary({ replicas: 2, pausedReplicas: null })).toBe("2 desired replicas");
    expect(replicaSummary({ replicas: 0, pausedReplicas: null })).toBe("0 desired replicas");
  });
});
