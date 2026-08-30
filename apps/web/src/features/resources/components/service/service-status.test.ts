import { describe, expect, test } from "vite-plus/test";

import { isServicePaused, replicaSummary } from "./service-status";

describe("isServicePaused", () => {
  test("paused only when the explicit marker is set", () => {
    expect(isServicePaused({ pausedReplicas: 2 })).toBe(true);
    expect(isServicePaused({ pausedReplicas: null })).toBe(false);
  });
});

describe("replicaSummary", () => {
  test("paused summary names the restored count", () => {
    expect(replicaSummary({ replicas: 0, pausedReplicas: 1 })).toBe(
      "Paused. 1 replica restored on resume",
    );
    expect(replicaSummary({ replicas: 0, pausedReplicas: 3 })).toBe(
      "Paused. 3 replicas restored on resume",
    );
  });

  test("normal summary shows the desired count, including zero", () => {
    expect(replicaSummary({ replicas: 1, pausedReplicas: null })).toBe("1 desired replica");
    expect(replicaSummary({ replicas: 2, pausedReplicas: null })).toBe("2 desired replicas");
    expect(replicaSummary({ replicas: 0, pausedReplicas: null })).toBe("0 desired replicas");
  });
});
