/**
 * In-process background services — the interval schedulers/sweepers the
 * control plane runs alongside the HTTP server. Split out of index.ts (which
 * has a hard line cap) as the list grew; each entry logs its own readiness so
 * startup output is unchanged. Returns a single stop handle for shutdown.
 */
import { startBackupScheduler } from "@otterdeploy/api/backups";
import { startEphemeralDbSweeper } from "@otterdeploy/api/ephemeral-db";
import { startDataFolderSweep } from "@otterdeploy/api/lib/data-folder-sweep";
import { startMetricsSampler } from "@otterdeploy/api/metrics";
import { startDeployCrashWatcher } from "@otterdeploy/api/routers/project/deploy-crash-watcher";
import { startAuditAnomalyScan } from "@otterdeploy/api/notifications/audit-anomaly";
import { startBlocklistScheduler } from "@otterdeploy/api/routers/firewall/scheduler";
import {
  startHealthAgentReconciler,
  startHostHealthMonitor,
  startLocalHealthSampler,
} from "@otterdeploy/api/system-health";
import { reconcileInterruptedDeployments } from "@otterdeploy/jobs/reconcile";
import { log } from "evlog";

/** Periodic deploy reconcile — the builder runs the same pass at ITS boot, but
 *  if the builder dies (or never comes up) nobody would ever fail its orphaned
 *  pending/building rows. Every 5m, with a 3m min-age so it can't race the
 *  insert-then-enqueue window of a deploy being created right now; the Redis
 *  run-once lock inside makes concurrent passes (builder boot + this) safe. */
function startDeployReconcile(): () => void {
  const RECONCILE_INTERVAL_MS = 5 * 60_000;
  const MIN_ROW_AGE_MS = 3 * 60_000;
  const tick = () => {
    void reconcileInterruptedDeployments({ minAgeMs: MIN_ROW_AGE_MS }).catch((cause) => {
      log.warn({
        reconcile: { event: "periodic-failed" },
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  };
  const interval = setInterval(tick, RECONCILE_INTERVAL_MS);
  return () => clearInterval(interval);
}

export function startBackgroundServices(): () => void {
  const stops: Array<() => void> = [];
  const start = (step: string, fn: () => () => void) => {
    stops.push(fn());
    log.info({ startup: { step, status: "ready" } });
  };

  // Backup schedule scanner — scans backup_schedule rows every minute and
  // runs due backups + retention (docs/designs/backups.md). DB is the source
  // of truth so cron/retention edits take effect immediately.
  start("backup-scheduler", startBackupScheduler);

  // Metrics sampler — records CPU/memory/network for managed containers into
  // resource_metric every 30s (feeds the service-node metrics charts).
  start("metrics-sampler", startMetricsSampler);

  // Host-health monitor — samples server memory/disk/docker usage every 5m,
  // records the platform_metric series, and emits host.pressure notifications
  // when thresholds are crossed.
  start("host-health-monitor", startHostHealthMonitor);

  // Per-server health (docs/designs/server-health-agent.md): the local 60s
  // sampler upserts this machine's snapshot into server_health_sample (feeds
  // the Servers page rows); the reconciler — swarm runtime only — keeps the
  // global health-agent service deployed so every node reports the same way.
  start("local-health-sampler", startLocalHealthSampler);
  start("health-agent-reconciler", startHealthAgentReconciler);

  // Ephemeral DB credential sweeper — disposes expired short-lived database
  // roles (terminate sessions + DROP ROLE) every minute. Postgres's own
  // VALID UNTIL already blocks new logins at expiry; this is the cleanup.
  start("ephemeral-db-sweeper", startEphemeralDbSweeper);

  // Managed blocklists — re-import enabled public/custom lists into CrowdSec on
  // their interval so the imported decisions refresh before they expire.
  start("blocklist-scheduler", startBlocklistScheduler);

  // Data-folder orphan sweep — reclaims artifact dirs (resources/projects/
  // backups) whose owning DB row is gone, e.g. after a crashed teardown
  // (docs/designs/data-folder.md, Phase 5). No-op when /data isn't in use.
  start("data-folder-sweep", startDataFolderSweep);

  // Audit-anomaly scan — periodic, conservative rules over recent audit rows
  // (denial bursts, mass deletions) that emit `audit.anomaly` notifications.
  start("audit-anomaly-scan", startAuditAnomalyScan);

  // Deploy reconcile — fails orphaned pending/building deployment rows whose
  // queue job is gone (builder crash, queue outage) so nothing sits in limbo
  // waiting for the next builder restart.
  start("deploy-reconcile", startDeployReconcile);

  // Deploy crash watcher — container die/oom events become deployment-log
  // lines ("restarting, attempt 2 of 5" / "gave up after 5 attempts"),
  // instant resource-changed pushes, and deploy.crashed notifications.
  start("deploy-crash-watcher", startDeployCrashWatcher);

  return () => {
    for (const stop of stops) stop();
  };
}
