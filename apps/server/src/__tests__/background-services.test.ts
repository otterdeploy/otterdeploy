import { mock } from "bun:test";
import { describe, expect, test } from "vite-plus/test";

/**
 * The control plane's background services are started from one list. Every
 * starter is stood in for here (each would otherwise open DB/Redis/Docker
 * connections), so what is checked is the wiring: a service in the list is
 * started once at boot and stopped by the handle the list returns.
 */

const stops = new Map<string, number>();
const starts = new Map<string, number>();

/** A stand-in starter that counts its start and the stop of its handle. */
function starter(name: string) {
  return mock(() => {
    starts.set(name, (starts.get(name) ?? 0) + 1);
    return () => stops.set(name, (stops.get(name) ?? 0) + 1);
  });
}

const stub = (path: string, names: string[]) =>
  mock.module(path, () => Object.fromEntries(names.map((name) => [name, starter(name)])));

await stub("@otterdeploy/api/backups", ["startBackupScheduler"]);
await stub("@otterdeploy/api/ephemeral-db", ["startEphemeralDbSweeper"]);
await stub("@otterdeploy/api/git/preview-reaper", ["startPreviewReaper"]);
await stub("@otterdeploy/api/lib/data-folder-sweep", ["startDataFolderSweep"]);
await stub("@otterdeploy/api/metrics", ["startMetricsSampler"]);
await stub("@otterdeploy/api/notifications/audit-anomaly", ["startAuditAnomalyScan"]);
await stub("@otterdeploy/api/notifications/edge-anomaly", ["startEdgeThreatScan"]);
await stub("@otterdeploy/api/routers/firewall/recorder", ["startFirewallRecorder"]);
await stub("@otterdeploy/api/routers/firewall/scheduler", ["startBlocklistScheduler"]);
await stub("@otterdeploy/api/routers/project/deploy-crash-watcher", ["startDeployCrashWatcher"]);
await stub("@otterdeploy/api/routers/server/enrollment", ["startNodeEnrollmentReaper"]);
await stub("@otterdeploy/api/routers/server/provision-status", ["startProvisionReaper"]);
await stub("@otterdeploy/api/routers/service/cert-recheck-sweep", ["startCertRecheckSweep"]);
await stub("@otterdeploy/api/system-health", [
  "startHealthAgentReconciler",
  "startHostHealthMonitor",
  "startLocalHealthSampler",
  "startOrphanResourceGc",
]);
await mock.module("@otterdeploy/jobs/reconcile", () => ({
  reconcileInterruptedDeployments: mock(async () => undefined),
}));

const { startBackgroundServices } = await import("../background-services");

describe("background services", () => {
  test("the stalled-provision reaper starts at boot and stops with the rest", () => {
    const stop = startBackgroundServices();
    expect(starts.get("startProvisionReaper")).toBe(1);
    expect(stops.get("startProvisionReaper")).toBeUndefined();
    stop();
    expect(stops.get("startProvisionReaper")).toBe(1);
  });
});
