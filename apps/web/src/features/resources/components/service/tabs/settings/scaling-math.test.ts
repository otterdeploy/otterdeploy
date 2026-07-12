import { describe, expect, test } from "vite-plus/test";

import {
  buildScalingPatch,
  clusterFitMessage,
  computeClusterFit,
  desiredReplicas,
  formatCpu,
  formatMemoryMb,
  groupRunningTasksByNode,
  initialScalingForm,
  isValidCpuLimit,
  isValidMemoryLimitMb,
  saveConsequence,
  type StoredScaling,
} from "./scaling-math";

const running = (stored?: Partial<StoredScaling>): StoredScaling => ({
  replicas: 2,
  pausedReplicas: null,
  cpuLimit: null,
  memoryLimitMb: null,
  ...stored,
});

const paused = (stored?: Partial<StoredScaling>): StoredScaling => ({
  replicas: 0,
  pausedReplicas: 3,
  cpuLimit: null,
  memoryLimitMb: null,
  ...stored,
});

describe("desiredReplicas / initialScalingForm", () => {
  test("running service seeds from the stored count", () => {
    expect(desiredReplicas(running())).toBe(2);
    expect(initialScalingForm(running()).replicas).toBe(2);
  });

  test("paused service seeds from the remembered count, not 0", () => {
    expect(desiredReplicas(paused())).toBe(3);
    expect(initialScalingForm(paused()).replicas).toBe(3);
  });

  test("a service scaled to zero on purpose still seeds a workable 1", () => {
    expect(initialScalingForm(running({ replicas: 0 })).replicas).toBe(1);
  });
});

describe("buildScalingPatch — pause guard", () => {
  test("no changes → null (nothing to save)", () => {
    const stored = running({ cpuLimit: 0.5, memoryLimitMb: 512 });
    expect(
      buildScalingPatch(stored, { replicas: 2, cpuLimit: 0.5, memoryLimitMb: 512 }),
    ).toBeNull();
  });

  test("limits-only edit while paused omits replicas — the pause survives", () => {
    const patch = buildScalingPatch(paused(), { replicas: 3, cpuLimit: 1, memoryLimitMb: null });
    expect(patch).toEqual({ resources: { cpuLimit: 1, memoryLimitMb: null } });
    expect(patch?.replicas).toBeUndefined();
  });

  test("explicit replica edit while paused sends replicas — resume with new count", () => {
    const patch = buildScalingPatch(paused(), { replicas: 5, cpuLimit: null, memoryLimitMb: null });
    expect(patch).toEqual({ replicas: 5 });
  });

  test("replica edit on a running service sends only replicas", () => {
    const patch = buildScalingPatch(running({ cpuLimit: 0.5, memoryLimitMb: 512 }), {
      replicas: 4,
      cpuLimit: 0.5,
      memoryLimitMb: 512,
    });
    expect(patch).toEqual({ replicas: 4 });
  });

  test("clearing a limit sends an explicit null (patch semantics)", () => {
    const patch = buildScalingPatch(running({ cpuLimit: 0.5, memoryLimitMb: 512 }), {
      replicas: 2,
      cpuLimit: null,
      memoryLimitMb: 512,
    });
    expect(patch).toEqual({ resources: { cpuLimit: null, memoryLimitMb: 512 } });
  });
});

describe("saveConsequence", () => {
  test("running service → redeploy", () => {
    expect(saveConsequence(running(), { replicas: 4 })).toBe("redeploy");
    expect(saveConsequence(running(), { resources: { cpuLimit: 1, memoryLimitMb: null } })).toBe(
      "redeploy",
    );
  });

  test("paused + replica change → resume", () => {
    expect(saveConsequence(paused(), { replicas: 5 })).toBe("resume");
  });

  test("paused + limits-only change stays paused", () => {
    expect(saveConsequence(paused(), { resources: { cpuLimit: 1, memoryLimitMb: null } })).toBe(
      "redeploy-paused",
    );
  });
});

describe("limit validation", () => {
  test("null means no limit and is always valid", () => {
    expect(isValidCpuLimit(null)).toBe(true);
    expect(isValidMemoryLimitMb(null)).toBe(true);
  });

  test("cpu bounds 0.1–8", () => {
    expect(isValidCpuLimit(0.1)).toBe(true);
    expect(isValidCpuLimit(8)).toBe(true);
    expect(isValidCpuLimit(0.05)).toBe(false);
    expect(isValidCpuLimit(8.5)).toBe(false);
    expect(isValidCpuLimit(Number.NaN)).toBe(false);
  });

  test("memory bounds 64–16384 MB, integer", () => {
    expect(isValidMemoryLimitMb(64)).toBe(true);
    expect(isValidMemoryLimitMb(16_384)).toBe(true);
    expect(isValidMemoryLimitMb(32)).toBe(false);
    expect(isValidMemoryLimitMb(20_000)).toBe(false);
    expect(isValidMemoryLimitMb(512.5)).toBe(false);
  });
});

describe("computeClusterFit", () => {
  const nodes = [
    { cpuTotal: 4, memTotalGb: 8 },
    { cpuTotal: 2, memTotalGb: 4 },
  ];

  test("no limits set → unknown (line omitted)", () => {
    expect(computeClusterFit({ replicas: 3, cpuLimit: null, memoryLimitMb: null, nodes })).toEqual({
      known: false,
    });
  });

  test("no servers / unreported capacity → unknown", () => {
    expect(computeClusterFit({ replicas: 3, cpuLimit: 1, memoryLimitMb: 512, nodes: [] })).toEqual({
      known: false,
    });
    expect(
      computeClusterFit({
        replicas: 3,
        cpuLimit: 1,
        memoryLimitMb: 512,
        nodes: [{ cpuTotal: 0, memTotalGb: 0 }],
      }),
    ).toEqual({ known: false });
  });

  test("within capacity → fits", () => {
    const fit = computeClusterFit({ replicas: 4, cpuLimit: 1, memoryLimitMb: 1024, nodes });
    expect(fit).toEqual({ known: true, fits: true, cpuExcessVcpu: 0, memExcessMb: 0 });
    expect(clusterFitMessage(fit)).toBe("Fits available capacity");
  });

  test("exceeds memory reports the exact overage", () => {
    // 16 × 1 GB = 16 GB requested vs 12 GB capacity → 4 GB over.
    const fit = computeClusterFit({ replicas: 16, cpuLimit: null, memoryLimitMb: 1024, nodes });
    expect(fit).toEqual({ known: true, fits: false, cpuExcessVcpu: 0, memExcessMb: 4096 });
    expect(clusterFitMessage(fit)).toBe("Exceeds cluster memory by 4 GB");
  });

  test("exceeds both dimensions joins the message", () => {
    const fit = computeClusterFit({ replicas: 10, cpuLimit: 1, memoryLimitMb: 2048, nodes });
    expect(clusterFitMessage(fit)).toBe("Exceeds cluster CPU by 4 vCPU and cluster memory by 8 GB");
  });

  test("float-step cpu math doesn't leak dust into the overage", () => {
    // 3 × 2.1 = 6.300000000000001 in raw float math; capacity is 6.
    const fit = computeClusterFit({ replicas: 3, cpuLimit: 2.1, memoryLimitMb: null, nodes });
    expect(fit).toEqual({ known: true, fits: false, cpuExcessVcpu: 0.3, memExcessMb: 0 });
  });

  test("one-dimension limit with the other unset only checks the set one", () => {
    const fit = computeClusterFit({ replicas: 6, cpuLimit: 1, memoryLimitMb: null, nodes });
    expect(fit).toEqual({ known: true, fits: true, cpuExcessVcpu: 0, memExcessMb: 0 });
  });
});

describe("formatting", () => {
  test("memory promotes to GB past 1024 and trims trailing .0", () => {
    expect(formatMemoryMb(512)).toBe("512 MB");
    expect(formatMemoryMb(1024)).toBe("1 GB");
    expect(formatMemoryMb(1536)).toBe("1.5 GB");
  });

  test("cpu rounds float dust", () => {
    expect(formatCpu(0.30000000000000004)).toBe("0.3 vCPU");
    expect(formatCpu(2)).toBe("2 vCPU");
  });
});

describe("groupRunningTasksByNode", () => {
  const nodes = [
    { id: "n1", hostname: "alpha" },
    { id: "n2", hostname: "beta" },
  ];

  test("counts only this service's running tasks, grouped by hostname", () => {
    const tasks = [
      { serviceId: "svc", nodeId: "n1", state: "running" },
      { serviceId: "svc", nodeId: "n1", state: "running" },
      { serviceId: "svc", nodeId: "n2", state: "running" },
      { serviceId: "svc", nodeId: "n2", state: "shutdown" }, // old task — ignored
      { serviceId: "other", nodeId: "n1", state: "running" }, // other service — ignored
    ];
    expect(groupRunningTasksByNode(tasks, nodes, "svc")).toEqual([
      { hostname: "alpha", running: 2 },
      { hostname: "beta", running: 1 },
    ]);
  });

  test("tasks on unlisted nodes bucket as unknown instead of vanishing", () => {
    const tasks = [{ serviceId: "svc", nodeId: "gone", state: "running" }];
    expect(groupRunningTasksByNode(tasks, nodes, "svc")).toEqual([
      { hostname: "(unknown node)", running: 1 },
    ]);
  });

  test("no running tasks → empty list", () => {
    expect(groupRunningTasksByNode([], nodes, "svc")).toEqual([]);
  });
});
