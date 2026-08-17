/**
 * Backup schedule scanner. Runs on a fixed control-plane tick (started from the
 * server bootstrap) rather than a BullMQ repeatable so user edits to
 * cron/retention take effect immediately. The DB is the source of truth (see
 * backup.ts schema notes). Each tick:
 *   1. finds enabled schedules due now (nextRunAt null or past)
 *   2. for each (source × destination), creates + executes a run, retrying a
 *      failed run up to the schedule's maxRetries with a short backoff
 *   3. computes the next fire time from the cron expression
 *   4. applies the retention policy (see retention-apply.ts)
 * A slower sweep raises `backup.overdue` (see overdue.ts). Boot runs
 * reconcileInterruptedBackups first so a crashed process can't strand rows in
 * `running` forever, and the tick itself is stamped for the /health probe.
 */
import type { BackupDestinationId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { log } from "evlog";

import { nextCronFire } from "../lib/cron";
import { emitPlatformEvent } from "../notifications/emit";
import { createBackupRun, getBackupStatus, reconcileInterruptedBackups } from "./db";
import { executeBackup } from "./engine";
import { sweepOverdueSchedules } from "./overdue";
import { applyRetention } from "./retention-apply";
import {
  type DueSchedule,
  type ResolvedSource,
  activeDestinationIdsFor,
  listDueSchedules,
  resolveScheduleSources,
  updateScheduleAfterRun,
} from "./schedule-db";

function nextFireTime(cron: string, from: Date): Date | null {
  const next = nextCronFire(cron, from);
  return next.isOk() ? next.value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff before retry N (1-based): 5s, 10s, 20s, capped at 30s. */
export function retryBackoffMs(retry: number): number {
  return Math.min(30_000, 5_000 * 2 ** (retry - 1));
}

/** Run one (source × destination) pair to a terminal status, retrying a failed
 *  run up to `maxRetries` extra attempts. Each attempt is its own run row so
 *  every attempt keeps its own logs + timings. Returns the final status. */
async function runPairWithRetry(
  schedule: DueSchedule,
  source: ResolvedSource,
  destinationId: BackupDestinationId,
): Promise<"succeeded" | "failed"> {
  const attempts = Math.max(0, schedule.maxRetries) + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const backupId = await createBackupRun({
      organizationId: schedule.organizationId,
      source: { kind: source.kind, resourceId: source.id },
      destinationId,
      scheduleId: schedule.id,
      encryption: schedule.encryption === "aes-256-gcm" ? "aes-256-gcm" : "none",
      method: "scheduled",
      attempt,
    });
    await executeBackup(backupId);
    const status = await getBackupStatus(backupId);
    if (status === "succeeded") return "succeeded";
    if (attempt < attempts) await sleep(retryBackoffMs(attempt));
  }
  return "failed";
}

// ── Tick loop ──────────────────────────────────────────────────────────────

let running = false;
let startedAt: Date | null = null;
let lastTickAt: Date | null = null;
let lastOverdueSweepAt = 0;

const OVERDUE_SWEEP_INTERVAL_MS = 15 * 60_000;
const LIVENESS_STALL_MS = 5 * 60_000;

/** Liveness surface for /health: unhealthy when the scheduler has started but
 *  hasn't ticked in 5 minutes (the tick stamp is independent of how long any
 *  actual backup takes, so long dumps never read as a stall). */
export function backupSchedulerLiveness(): {
  startedAt: Date | null;
  lastTickAt: Date | null;
  healthy: boolean;
} {
  const reference = lastTickAt ?? startedAt;
  const healthy =
    startedAt == null || (reference != null && Date.now() - reference.getTime() < LIVENESS_STALL_MS);
  return { startedAt, lastTickAt, healthy };
}

/** One scan pass. Safe to call repeatedly; self-guards against overlap. */
export async function runDueBackupSchedules(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await listDueSchedules(now);
    for (const schedule of due) {
      const outcome = await Result.tryPromise({
        try: () => runSchedule(schedule, now),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      if (outcome.isErr()) {
        log.error({
          backups: { scheduler: schedule.id, status: "error" },
          error: outcome.error.message,
        });
      }
    }
    if (now.getTime() - lastOverdueSweepAt >= OVERDUE_SWEEP_INTERVAL_MS) {
      lastOverdueSweepAt = now.getTime();
      await sweepOverdueSchedules(now);
    }
  } finally {
    running = false;
  }
}

async function runSchedule(schedule: DueSchedule, now: Date): Promise<void> {
  // A null nextRunAt means the schedule was just created. Only initialize its
  // fire time, don't backfill a run. Otherwise it's genuinely due.
  if (schedule.nextRunAt == null) {
    await updateScheduleAfterRun(schedule.id, {
      lastRunAt: now,
      lastRunStatus: "queued",
      nextRunAt: nextFireTime(schedule.cron, now),
    });
    return;
  }

  const resolved = await resolveScheduleSources(schedule.organizationId, schedule.sources);
  // Operator intent is enforced here, at fan-out: a disabled destination stops
  // receiving new backups while its existing snapshots stay restorable.
  const destinationIds = await activeDestinationIdsFor(schedule.destinationIds);

  // A due schedule that resolves to no runnable (source × destination) pair is
  // orphaned or misconfigured: record `failed`, not a benign placeholder.
  let lastStatus: "succeeded" | "failed" = "failed";
  if (resolved.length > 0 && destinationIds.length > 0) {
    // One dump per (source × destination): each is its own single-destination
    // backup record, so the engine, restore, and retention stay unchanged.
    // `lastRunStatus` reports the WORST pair outcome: a schedule whose runs
    // failed must not present a reassuring green row.
    let anyFailed = false;
    for (const source of resolved) {
      for (const destinationId of destinationIds) {
        const status = await runPairWithRetry(schedule, source, destinationId);
        if (status === "failed") anyFailed = true;
      }
    }
    lastStatus = anyFailed ? "failed" : "succeeded";
    // Retention runs even after a failed pair: one flaky destination must not
    // let every other repo's history grow unbounded.
    await applyRetention(schedule);
  }

  await updateScheduleAfterRun(schedule.id, {
    lastRunAt: now,
    lastRunStatus: lastStatus,
    nextRunAt: nextFireTime(schedule.cron, now),
  });
}

/** Boot-time crash recovery: fail runs the previous process left in flight,
 *  clear orphaned locks, and notify each affected org. */
async function reconcileAtBoot(): Promise<void> {
  const outcome = await Result.tryPromise({
    try: async () => {
      const failed = await reconcileInterruptedBackups();
      if (failed.length === 0) return;
      log.warn({ backups: { reconcile: "interrupted-runs-failed", count: failed.length } });
      for (const run of failed) {
        await emitPlatformEvent({
          organizationId: run.organizationId,
          eventId: "backup.failed",
          title: "Backup interrupted",
          message: "A backup was interrupted by a server restart and has been marked failed.",
          data: { backupId: run.id },
        });
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (outcome.isErr()) {
    log.error({ backups: { reconcile: "boot-failed" }, error: outcome.error.message });
  }
}

/** Start the periodic scanner. Returns a stop handle. */
export function startBackupScheduler(intervalMs = 60_000): () => void {
  startedAt = new Date();
  lastTickAt = null;
  void reconcileAtBoot();
  const timer = setInterval(() => {
    lastTickAt = new Date();
    void runDueBackupSchedules();
  }, intervalMs);
  // Don't keep the event loop alive solely for backups.
  timer.unref?.();
  return () => clearInterval(timer);
}
